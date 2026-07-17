import { TwitterClient } from "../TwitterClient/TwitterClient.js";
import {getTwitterClient} from"../twitter/getClient.js";

// Cookies from a logged-in x.com session.

const {client} = await getTwitterClient()



const userIds = [
  "2067583076100968448",
];

const res = await client.getUsersByIds(userIds);

if (!res.success) {
  console.error("getUsersByIds failed:", res);
  process.exit(1);
}

console.log(res)