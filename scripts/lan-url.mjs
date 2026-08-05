/**
 * 印出手機可以連的網址。
 *
 * 為什麼需要:`next dev` 印的 Network 網址是它抓到的第一張網卡,在有 WSL /
 * Docker / VPN 虛擬網卡的機器上常常是 172.x 這種連不到的位址。而且 DHCP 會換 IP,
 * 昨天能用的網址今天就失效了 —— 這個腳本每次都給你當下正確的。
 *
 * 用法:pnpm url
 */
import { networkInterfaces } from "node:os";

const PORT = process.env.PORT ?? "3000";

/** 明顯是虛擬網卡的名稱關鍵字,排到後面 */
const VIRTUAL_HINTS = ["wsl", "hyper-v", "vethernet", "docker", "vmware", "virtualbox", "loopback"];

const candidates = [];
for (const [name, addrs] of Object.entries(networkInterfaces())) {
  for (const addr of addrs ?? []) {
    if (addr.family !== "IPv4" || addr.internal) continue;
    const lower = name.toLowerCase();
    const isVirtual = VIRTUAL_HINTS.some((h) => lower.includes(h));
    // 家用/辦公室網段優先(192.168.x、10.x、172.16–31.x 的實體網卡)
    const isPrivateLan = /^(192\.168\.|10\.)/.test(addr.address);
    candidates.push({ name, ip: addr.address, isVirtual, isPrivateLan });
  }
}

candidates.sort((a, b) => {
  if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1;
  if (a.isPrivateLan !== b.isPrivateLan) return a.isPrivateLan ? -1 : 1;
  return a.ip.localeCompare(b.ip);
});

if (candidates.length === 0) {
  console.log("找不到對外的 IPv4 位址 —— 確認網路是否連著。");
  process.exit(1);
}

console.log("手機請開(與電腦連同一個 Wi-Fi):\n");
candidates.forEach((c, i) => {
  const tag = i === 0 ? "  ← 用這個" : c.isVirtual ? "  (虛擬網卡,通常連不到)" : "";
  console.log(`  http://${c.ip}:${PORT}${tag}`);
  console.log(`      網卡:${c.name}`);
});
console.log("\n注意:IP 由 DHCP 分配,換網路或重開機後可能改變 —— 連不上就再跑一次 pnpm url。");
