import { FxTwitterClient } from '../fxTwitter/fxTwitterClient.js';

const client = new FxTwitterClient();

client.getProfileStatuses("dipuweb3",{count: 10}).then((profile) => {
  console.log(profile);
  console.log(profile?.results?.length);
}).catch((error: unknown) => {
  console.error("Error fetching profile:", error);
});

