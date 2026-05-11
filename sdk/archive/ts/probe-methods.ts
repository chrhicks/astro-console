import { SeestarDevice } from "./device.js";

async function main() {
  const device = new SeestarDevice({
    host: "192.168.4.23",
    port: 4700,
    pemPath: "../seestar_3.1.2_fw_7.32_interop.pem",
    timeoutMs: 15000,
  });
  await device.connectAndAuth();

  const methods = [
    "get_files",
    "list_files",
    "list_folder",
    "browse_folder",
    "get_folder",
    "get_album_files",
    "get_files_in_folder",
    "get_file_info",
    "read_folder",
    "list_dir",
  ];

  for (const method of methods) {
    try {
      const resp = await device.rawClient.sendSync(method, { path: "MyWorks/Solar_video" });
      console.log(`${method}: code=${resp.code}, result=${JSON.stringify(resp.result)?.slice(0, 500)}`);
    } catch (e: any) {
      console.log(`${method}: ERROR - ${e.message}`);
    }
  }

  device.disconnect();
}

main().catch(console.error);
