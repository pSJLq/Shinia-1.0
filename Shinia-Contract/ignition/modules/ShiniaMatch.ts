import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ShiniaMatchModule = buildModule("ShiniaMatchModule", (m) => {
  const devWallet = m.getParameter("devWallet");
  
  const shiniaMatch = m.contract("ShiniaMatch", [devWallet]);
  
  return { shiniaMatch };
});

export default ShiniaMatchModule;