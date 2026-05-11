import { SeestarDevice } from "./device.js";

async function main() {
  const host = process.env.SEESTAR_HOST || "192.168.4.23";
  const pemPath = process.env.SEESTAR_PEM || "../seestar_3.1.2_fw_7.32_interop.pem";
  const albumName = process.env.SEESTAR_ALBUM || process.argv[2] || "Solar_video";

  const device = new SeestarDevice({
    host,
    port: 4700,
    pemPath,
    timeoutMs: 15000,
  });

  const ok = await device.connectAndAuth();
  if (!ok) {
    throw new Error("Authentication failed");
  }

  const albums = await device.getAlbums();
  if (!albums) {
    throw new Error("get_albums failed");
  }

  const summary = albums.list
    .flatMap((group) => group.files)
    .find((file) => file.name === albumName);

  console.log(`Album summary for ${albumName}:`);
  console.log(JSON.stringify(summary, null, 2));
  console.log("");

  const entries = await device.listAlbumDirectory(albumName);
  console.log(`Actual files in MyWorks/${albumName}:`);
  for (const entry of entries) {
    const kind = entry.isDirectory ? "dir" : "file";
    console.log(`${kind.padEnd(4)} ${String(entry.sizeBytes).padStart(9)}  ${entry.modifiedRaw}  ${entry.name}`);
  }

  device.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
