import type { AuthRole } from "@ald/domain";

export type StaffWorkspaceCapabilities = Readonly<{
  canViewSalary: boolean;
  canEditSalary: boolean;
  canEditAssignment: boolean;
  canEditSchedule: boolean;
  canUploadPrivateDocuments: boolean;
  canViewPrivateDocuments: boolean;
  canTerminateStaff: boolean;
  canCorrectStartDate: boolean;
}>;

const GENERAL_MANAGER_CAPABILITIES = {
  canViewSalary: true,
  canEditSalary: true,
  canEditAssignment: true,
  canEditSchedule: true,
  canUploadPrivateDocuments: true,
  canViewPrivateDocuments: true,
  canTerminateStaff: true,
  canCorrectStartDate: true,
} as const satisfies StaffWorkspaceCapabilities;

const TRAINING_MANAGER_CAPABILITIES = {
  canViewSalary: false,
  canEditSalary: false,
  canEditAssignment: true,
  canEditSchedule: true,
  canUploadPrivateDocuments: true,
  canViewPrivateDocuments: true,
  canTerminateStaff: false,
  canCorrectStartDate: false,
} as const satisfies StaffWorkspaceCapabilities;

const NO_STAFF_WORKSPACE_CAPABILITIES = {
  canViewSalary: false,
  canEditSalary: false,
  canEditAssignment: false,
  canEditSchedule: false,
  canUploadPrivateDocuments: false,
  canViewPrivateDocuments: false,
  canTerminateStaff: false,
  canCorrectStartDate: false,
} as const satisfies StaffWorkspaceCapabilities;

export function staffWorkspaceCapabilitiesFor(role: AuthRole): StaffWorkspaceCapabilities {
  if (role === "GENERAL_MANAGER") return GENERAL_MANAGER_CAPABILITIES;
  if (role === "TRAINING_MANAGER") return TRAINING_MANAGER_CAPABILITIES;
  return NO_STAFF_WORKSPACE_CAPABILITIES;
}
