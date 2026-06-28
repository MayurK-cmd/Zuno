// Check both contracts via Soroban RPC
import { Contract, SorobanRpc, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";

const servers = [
  { name: "CBZVY (docs claim)", id: "CBZVYOLXMVQYGHTJDRVRSB7ABR74UDV7CUIIMMHEH2JAEYAKQJOMJNAW" },
  { name: "CCMH  (env claim) ", id: "CCMHETHXUZ5M7Y3ZD535Y6JQD35F7AKO2BSUKNETLIWTDRCDAQRASDXI" },
];

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

for (const c of servers) {
  console.log(`\n=== ${c.name} ===`);
  try {
    // Try to read the contract's Wasm entry from instance storage.
    // LedgerKey for ContractData: hash(contractId) || ScVal::LedgerKeyContractData
    // Easier: just try to call getContractData on a known key, or simulate a no-op invokeHostFunction.
    // The cleanest path: use getContractData with key=ScVal::Void (instance key).
    const key = xdr.ScVal.scvVoid();
    const entry = await server.getContractData(c.id, key, "instance");
    console.log("✓ Contract EXISTS. Instance storage has", entry.val.contractData().val().switch().name, "entries");
  } catch (e) {
    console.log("✗ Contract NOT FOUND or no instance entry:", e?.message?.slice(0, 200) ?? e);
  }
}
