// GetMoni API client — public entry point.
//
// Usage:
//   import { MoniClient, MoniStatus, ObservedType } from "./getmoni/index.js";
//
//   const moni = new MoniClient({ accessToken, refreshToken });
//   const res = await moni.getSmartFollowers({
//     observedId: "5557856978",
//     observedType: ObservedType.TwitterAccount,
//     limit: 50,
//   });
//   if (res.status === MoniStatus.Success) console.log(res.data);

export { MoniClient } from "./MoniClient.js";
export * from "./types.js";


