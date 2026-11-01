"""Restricted stdio bridge between the extension and official Pikafish."""

import argparse
import collections
import hashlib
import json
import os
import queue
import re
import struct
import subprocess
import sys
import threading
import time


MAX_MESSAGE_BYTES = 65536
ORIGIN = re.compile(r"chrome-extension://[a-p]{32}/\Z")
MOVE = re.compile(r"[a-i][0-9][a-i][0-9]\Z")


def read_exact(stream, length, allow_eof=False):
    parts = bytearray()
    while len(parts) < length:
        chunk = stream.read(length - len(parts))
        if not chunk:
            if allow_eof and not parts:
                return None
            raise ValueError("Truncated native messaging frame.")
        parts.extend(chunk)
    return bytes(parts)


def read_message(stream):
    header = read_exact(stream, 4, allow_eof=True)
    if header is None:
        return None
    length = struct.unpack("<I", header)[0]
    if not 0 < length <= MAX_MESSAGE_BYTES:
        raise ValueError("Native message exceeds the 64 KB limit.")
    value = json.loads(read_exact(stream, length).decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Native messages must be JSON objects.")
    return value


class Writer:
    def __init__(self, stream):
        self.stream = stream
        self.lock = threading.Lock()

    def send(self, message):
        body = json.dumps(message, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        if len(body) > MAX_MESSAGE_BYTES:
            raise ValueError("Native response exceeds the 64 KB limit.")
        with self.lock:
            self.stream.write(struct.pack("<I", len(body)) + body)
            self.stream.flush()


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_config(path, caller_origin):
    with open(path, "r", encoding="utf-8-sig") as stream:
        config = json.load(stream)
    if not isinstance(config, dict):
        raise ValueError("Invalid native host configuration.")
    origins = config.get("allowed_origins")
    if not isinstance(origins, list) or not 1 <= len(origins) <= 8 or any(
        not isinstance(origin, str) or not ORIGIN.fullmatch(origin) for origin in origins
    ):
        raise ValueError("Invalid configured extension origins.")
    if not isinstance(caller_origin, str) or caller_origin.rstrip("/") + "/" not in origins:
        raise ValueError("This extension is not allowed to access Pikafish.")
    for name in ("engine", "network"):
        target = config.get(name + "Path")
        expected = config.get(name + "Sha256")
        if not isinstance(target, str) or any(ord(char) < 32 for char in target) or not os.path.isabs(target) or not os.path.isfile(target):
            raise ValueError("Configured %s file is unavailable." % name)
        if not isinstance(expected, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
            raise ValueError("Configured %s SHA256 is invalid." % name)
        if file_sha256(target) != expected.lower():
            raise ValueError("Configured %s SHA256 does not match." % name)
    for field, minimum, maximum in (("threads", 1, 16), ("hash", 16, 1024)):
        value = config.get(field)
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError("Configured %s is outside the supported range." % field)
    return config


def valid_fen(fen):
    fields = fen.split(" ")
    if len(fields) != 6 or fields[1] not in ("w", "b") or fields[2:4] != ["-", "-"]:
        return False
    if not re.fullmatch(r"[0-9]+", fields[4]) or not re.fullmatch(r"[1-9][0-9]*", fields[5]):
        return False
    if not 0 <= int(fields[4]) <= 119 or not 1 <= int(fields[5]) <= 100000:
        return False
    rows = fields[0].split("/")
    if len(rows) != 10 or fields[0].count("k") != 1 or fields[0].count("K") != 1:
        return False
    return all(
        re.fullmatch(r"[1-9rnbakcpRNBAKCP]+", row)
        and sum(int(char) if char.isdigit() else 1 for char in row) == 9
        for row in rows
    )


def validate_command(message):
    if set(message) != {"type", "command"} or message.get("type") != "command":
        raise ValueError("Unsupported native message.")
    command = message.get("command")
    if not isinstance(command, str) or not 0 < len(command) <= 8192 or any(
        ord(char) < 32 or ord(char) > 126 for char in command
    ):
        raise ValueError("Invalid UCI command.")
    if command in ("uci", "isready", "ucinewgame", "d", "eval", "stop", "quit", "setoption name Clear Hash"):
        return command
    if command in ("go infinite", "go perft 1"):
        return command
    timed = re.fullmatch(r"go (movetime|depth) ([1-9][0-9]*)", command)
    if timed and int(timed[2]) <= (3500 if timed[1] == "movetime" else 128):
        return command
    option = re.fullmatch(r"setoption name (Threads|Hash|MultiPV|Move Overhead|Ponder|UCI_ShowWDL) value ([a-z0-9]+)", command)
    if option:
        bounds = {"Threads": (1, 16), "Hash": (16, 1024), "MultiPV": (1, 4), "Move Overhead": (0, 5000)}
        name, value = option.groups()
        if name == "Ponder" and value == "false":
            return command
        if name == "UCI_ShowWDL" and value in ("true", "false"):
            return command
        if name in bounds and value.isdigit() and bounds[name][0] <= int(value) <= bounds[name][1]:
            return command
    if command.startswith("position "):
        setup, separator, history = command.partition(" moves ")
        if setup == "position startpos" or (setup.startswith("position fen ") and valid_fen(setup[13:])):
            if not separator:
                return command
            moves = history.split(" ")
            if 1 <= len(moves) <= 1024 and all(MOVE.fullmatch(move) and move[:2] != move[2:] for move in moves):
                return command
    raise ValueError("UCI command is not permitted.")


class NativeHost:
    def __init__(self, config, incoming, outgoing):
        self.config = config
        self.incoming = incoming
        self.writer = Writer(outgoing)
        self.events = queue.Queue(maxsize=256)
        self.stderr = collections.deque(maxlen=6)
        self.process = None
        self.state = "uci"
        self.nnue_verified = False
        self.engine_name = "Pikafish"
        self.search_started = None
        self.stop_sent = False

    def write_uci(self, command):
        if not self.process or self.process.poll() is not None:
            raise RuntimeError("Pikafish exited unexpectedly.")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def read_native(self):
        try:
            while True:
                message = read_message(self.incoming)
                self.events.put(("eof" if message is None else "message", message))
                if message is None:
                    return
        except (OSError, ValueError, UnicodeError, RecursionError) as error:
            self.events.put(("protocol_error", str(error)))

    def read_engine(self):
        try:
            for line in self.process.stdout:
                line = line.rstrip("\r\n")
                if len(line) > 16000:
                    self.events.put(("protocol_error", "Pikafish produced an oversized line."))
                    return
                self.events.put(("line", line))
        except (OSError, ValueError) as error:
            self.events.put(("protocol_error", str(error)))
        finally:
            self.events.put(("engine_eof", None))

    def read_stderr(self):
        try:
            for line in self.process.stderr:
                self.stderr.append(line.strip()[:500])
        except (OSError, ValueError):
            pass

    def handle_line(self, line):
        self.writer.send({"type": "engine", "line": line})
        if "CRITICAL ERROR" in line or "ERROR: NNUE" in line:
            raise RuntimeError(line[:1000])
        if line.startswith("id name "):
            self.engine_name = line[8:]
        if self.state == "uci" and line == "uciok":
            for command in (
                "setoption name Threads value %d" % self.config["threads"],
                "setoption name Hash value %d" % self.config["hash"],
                "setoption name EvalFile value " + self.config["networkPath"],
                "setoption name Ponder value false",
                "position startpos",
                "go depth 1",
            ):
                self.write_uci(command)
            self.state = "probe"
        elif self.state == "probe":
            lowered = line.lower()
            if "nnue" in lowered and "evaluation" in lowered and "using" in lowered and "disabled" not in lowered:
                self.nnue_verified = True
            if line.startswith("bestmove "):
                if not self.nnue_verified or not MOVE.fullmatch(line.split(" ")[1]):
                    raise RuntimeError("Pikafish did not verify its NNUE evaluation.")
                self.state = "synchronizing"
                self.write_uci("isready")
        elif self.state == "synchronizing" and line == "readyok":
            self.state = "ready"
            self.writer.send({
                "type": "ready", "name": "Pikafish", "version": self.engine_name,
                "nnue": os.path.basename(self.config["networkPath"]),
                "networkSha256": self.config["networkSha256"],
                "threads": self.config["threads"], "hash": self.config["hash"],
                "enginePid": self.process.pid,
            })
        if self.state == "ready" and line.startswith("bestmove "):
            self.search_started = None
            self.stop_sent = False

    def run(self):
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            [self.config["enginePath"]], cwd=os.path.dirname(self.config["enginePath"]),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", bufsize=1, creationflags=flags,
        )
        threading.Thread(target=self.read_native, daemon=True).start()
        threading.Thread(target=self.read_engine, daemon=True).start()
        threading.Thread(target=self.read_stderr, daemon=True).start()
        startup = time.monotonic()
        try:
            self.write_uci("uci")
            while True:
                now = time.monotonic()
                if self.state != "ready" and now - startup > 15:
                    raise RuntimeError("Pikafish NNUE initialization timed out.")
                if self.search_started is not None:
                    elapsed = now - self.search_started
                    if elapsed > 4.3:
                        raise RuntimeError("Pikafish exceeded the search deadline.")
                    if elapsed > 3.6 and not self.stop_sent:
                        self.write_uci("stop")
                        self.stop_sent = True
                try:
                    kind, value = self.events.get(timeout=0.05)
                except queue.Empty:
                    continue
                if kind == "eof":
                    return 0
                if kind == "engine_eof":
                    detail = " ".join(self.stderr)
                    raise RuntimeError("Pikafish exited unexpectedly." + (" " + detail if detail else ""))
                if kind == "protocol_error":
                    raise ValueError(value)
                if kind == "line":
                    self.handle_line(value)
                elif kind == "message":
                    try:
                        command = validate_command(value)
                        if self.state != "ready":
                            raise ValueError("Pikafish is still initializing.")
                        if self.search_started is not None and command not in ("stop", "isready", "quit"):
                            raise ValueError("Stop the current search before sending another command.")
                        self.write_uci(command)
                        if command.startswith("go ") and command != "go perft 1":
                            self.search_started = time.monotonic()
                            self.stop_sent = False
                        if command == "quit":
                            return 0
                    except ValueError as error:
                        self.writer.send({"type": "error", "error": str(error)})
        finally:
            self.close()

    def close(self):
        process = self.process
        if process is None:
            return
        if process.poll() is None:
            try:
                process.stdin.write("quit\n")
                process.stdin.flush()
                process.wait(timeout=0.25)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                process.terminate()
                try:
                    process.wait(timeout=0.5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=0.5)
        for stream in (process.stdin, process.stdout, process.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("origin")
    parser.add_argument("--parent-window", type=int, default=0)
    args = parser.parse_args()
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    writer = Writer(sys.stdout.buffer)
    try:
        config = load_config(args.config, args.origin)
        return NativeHost(config, sys.stdin.buffer, sys.stdout.buffer).run()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        try:
            writer.send({"type": "error", "error": str(error)[:2000]})
        except (OSError, ValueError):
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
