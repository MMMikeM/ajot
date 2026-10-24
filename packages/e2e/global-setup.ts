import { getOrCreateUser } from "./helpers/auth";
import { USER_1 } from "./helpers/users";

// A new server takes one signup without an invite. Making it here, before any worker starts,
// leaves every worker's accounts to be invited by it rather than racing to be first.
export default async () => {
  await getOrCreateUser(USER_1);
};
