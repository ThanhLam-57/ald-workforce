import { redirect } from "next/navigation";

import { listAttendanceStaff } from "@/server/attendance-service";
import { getOptionalActor } from "@/server/auth-context";
import { listBranches, listStaff } from "@/server/services";

import { AttendanceWorkspace } from "./attendance-workspace";
import { BranchOverviewWorkspace } from "./branch-overview-workspace";
import { CompanyIntelligenceWorkspace } from "./company-intelligence-workspace";
import { ConfiguredRuleCenter } from "./configured-rule-center";
import { DataGovernanceWorkspace } from "./data-governance-workspace";
import { FoundationAdmin } from "./foundation-admin";
import { ManagerKpiWorkspace } from "./manager-kpi-workspace";
import { PenaltyRuleCenter } from "./penalty-rule-center";
import { PayrollWorkspace } from "./payroll-workspace";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

const roleLabels = {
  GENERAL_MANAGER: "Tổng quản lý",
  TRAINING_MANAGER: "Quản lý đào tạo",
  LIVE_EMPLOYEE: "Nhân viên Live",
} as const;

export default async function DashboardPage() {
  const actor = await getOptionalActor();
  if (!actor) {
    redirect("/login");
  }

  const [branches, staff, attendanceStaff] =
    actor.role === "LIVE_EMPLOYEE"
      ? [[], [], []]
      : await Promise.all([
          listBranches(actor),
          listStaff(actor, new Date()),
          listAttendanceStaff(actor, new Date()),
        ]);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            ALD Workforce
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Tổng quan nền tảng</h1>
          <p className="mt-2 text-sm text-slate-600">
            {roleLabels[actor.role]} · phạm vi {branches.length} cơ sở
          </p>
        </div>
        <SignOutButton />
      </header>

      {actor.role === "LIVE_EMPLOYEE" ? (
        <PayrollWorkspace branches={[]} isGeneralManager={false} />
      ) : (
        <>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold">Cơ sở trong phạm vi</h2>
              {branches.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Chưa có cơ sở được phân công.</p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100">
                  {branches.map((branch) => (
                    <li className="flex justify-between gap-4 py-3" key={branch.id}>
                      <span>{branch.name}</span>
                      <span className="font-mono text-sm text-slate-500">{branch.code}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold">Nhân sự trong phạm vi</h2>
              {staff.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Chưa có nhân sự phù hợp.</p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100">
                  {staff.map((person) => (
                    <li className="py-3" key={person.id}>
                      <div className="font-medium">{person.fullName}</div>
                      <div className="text-sm text-slate-500">
                        {person.staffCode} · {person.jobTitle}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <AttendanceWorkspace
            canOverridePenalty={actor.role === "GENERAL_MANAGER"}
            staff={attendanceStaff}
          />
          {actor.role === "GENERAL_MANAGER" ? (
            <CompanyIntelligenceWorkspace
              branches={branches.map((branch) => ({
                id: branch.id,
                code: branch.code,
                name: branch.name,
              }))}
            />
          ) : null}
          <ManagerKpiWorkspace isGeneralManager={actor.role === "GENERAL_MANAGER"} />
          <BranchOverviewWorkspace
            branches={branches.map((branch) => ({
              id: branch.id,
              code: branch.code,
              name: branch.name,
            }))}
            isGeneralManager={actor.role === "GENERAL_MANAGER"}
          />
          <ConfiguredRuleCenter isGeneralManager={actor.role === "GENERAL_MANAGER"} />
          {actor.role === "GENERAL_MANAGER" ? (
            <PayrollWorkspace
              branches={branches.map((branch) => ({
                id: branch.id,
                code: branch.code,
                name: branch.name,
              }))}
              isGeneralManager
            />
          ) : null}
          {actor.role === "GENERAL_MANAGER" ? <PenaltyRuleCenter /> : null}
          <DataGovernanceWorkspace
            branches={branches.map((branch) => ({
              id: branch.id,
              code: branch.code,
              name: branch.name,
            }))}
            isGeneralManager={actor.role === "GENERAL_MANAGER"}
          />
          {actor.role === "GENERAL_MANAGER" ? (
            <FoundationAdmin
              branches={branches.map((branch) => ({
                id: branch.id,
                label: `${branch.code} — ${branch.name}`,
              }))}
              staff={staff.map((person) => ({
                id: person.id,
                label: `${person.staffCode} — ${person.fullName}`,
              }))}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
