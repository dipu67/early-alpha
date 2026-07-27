import { FxTwitterClient } from '../fxTwitter/fxTwitterClient.js';

const client = new FxTwitterClient();

client.trends().then((profile) => {
  console.log(profile);
  console.log(profile.trends.length);
}).catch((error: unknown) => {
  console.error("Error fetching profile:", error);
});

