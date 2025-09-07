import { spawn } from "child_process";
import inquirer from "inquirer";

const scripts = {
  "Render Video": ["render.js"],
  "Tải video": ["download.js"],
  "Tải lại video lỗi": ["download.js", "retry"],
  "Cắt video -> 30s": ["trim-videos.js"],
  "Cắt video background": ["cut-bg.js"],
};
async function main() {
  const { script } = await inquirer.prompt([
    {
      type: "list",
      name: "script",
      message: "Chọn script bạn muốn chạy:",
      choices: Object.keys(scripts),
    },
  ]);

  let args = [];

  // if (script === "Render Video") {
  //   const { params } = await inquirer.prompt([
  //     {
  //       type: "input",
  //       name: "params",
  //       message: "Nhập các tham số cho render (cách nhau bởi khoảng trắng):",
  //     },
  //   ]);
  //   args = params.split(" "); // Chuyển params thành mảng
  // }

  console.log(`\n🚀 Đang chạy: node ${scripts[script]} ${args.join(" ")}\n`);

  const child = spawn("node", [...scripts[script], ...args], {
    stdio: "inherit",
  });

  child.on("close", (code) => {
    console.log(`\n✅ Process exited with code ${code}\n`);
  });
}

main();
