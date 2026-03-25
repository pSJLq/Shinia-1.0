import * as dotenv from "dotenv";
dotenv.config();
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
  version: "0.8.28",
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
},
  networks: {
    somniaTestnet: {
      type: "http",
      url: "https://dream-rpc.somnia.network/",
      chainId: 50312,
      accounts: [PRIVATE_KEY],
    },
  },
};

export default config;