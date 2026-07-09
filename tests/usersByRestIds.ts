import { TwitterClient } from "../TwitterClient/TwitterClient.js";
import {getTwitterClient} from"../twitter/getClient.js";

// Cookies from a logged-in x.com session.

const {client} = await getTwitterClient()



const userIds = [
  "2025465937781260288",
  "1388477070523572227",
];

const res = await client.getUserByScreenName("dipuweb3");

if (!res.success) {
  console.error("getUsersByIds failed:", res);
  process.exit(1);
}

console.log(res)