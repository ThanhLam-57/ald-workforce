import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

export const authAccessControl = createAccessControl(defaultStatements);

export const generalManagerAuthRole = authAccessControl.newRole({
  // Account administration must go through the scoped application services,
  // never through Better Auth's generic admin REST endpoints.
  user: [],
  session: [],
});

export const trainingManagerAuthRole = authAccessControl.newRole({
  user: [],
  session: [],
});

export const liveEmployeeAuthRole = authAccessControl.newRole({
  user: [],
  session: [],
});
