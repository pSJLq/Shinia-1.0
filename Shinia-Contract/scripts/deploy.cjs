const hre = require("hardhat");

async function main() {
  const devWallet = "0x6e98077d24Efa3D5395637724693c8A225d08bF3";

  const ShiniaMatch = await hre.ethers.getContractFactory("ShiniaMatch");
  const contract = await ShiniaMatch.deploy(devWallet);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("ShiniaMatch deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});