// One daemon for the concurrent startup test: `bun listen-fixture.ts <folder> <start ms>` waits
// until the start time, listens in the folder and prints `ok` or the error. The winner keeps
// listening and answers every request with its process id, until it is killed.
import { unixSocketChannel } from "@/shared/ipc";

const [folder, start] = process.argv.slice(2) as [string, string];
await Bun.sleep(Math.max(0, Number(start) - Date.now()));
try {
  await unixSocketChannel(folder).listen((connection) => ({
    message(message) {
      if (message.ok && "id" in message.message) {
        connection.send({ jsonrpc: "2.0", id: message.message.id ?? null, result: process.pid });
      }
    },
    close() {},
  }));
  console.log("ok");
} catch (error) {
  console.log((error as Error).message);
}
