import { createServer } from "node:http";

// The IPC channel closes even if the parent is killed while an install blocks its event loop.
// Do not leave an orphan listener behind on cancellation (including Windows process termination).
process.on("disconnect", () => process.exit(0));
if (!process.connected) process.exit(1);

createServer((request, response) => {
  process.stderr.write(`published-shape: the empty registry refused ${request.url}\n`);
  response.writeHead(404).end();
}).listen(0, "127.0.0.1", function () {
  process.send(this.address().port, (error) => {
    if (error) process.exit(0); // The parent may disconnect before the readiness message is sent.
  });
});
