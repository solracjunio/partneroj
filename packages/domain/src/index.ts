// Pure business rules: weighted split, settlement, debt simplification and vote counting.
// No framework, database or I/O here (see docs/adr).
export { splitByWeights, type Share } from "./split.js";
export {
  computeBalances,
  type Balances,
  type Entry,
  type Party,
  type PartnerBalance,
} from "./balances.js";
