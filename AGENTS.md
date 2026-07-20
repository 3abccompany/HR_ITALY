# AGENTS.md

## Project context

This is a multi-tenant HR Italy application developed for Italian HR management.

Core modules include:
- Employees / persons
- Contracts
- Attendance
- Holidays registry
- CCNL
- CCNL Levels / Livelli
- Payroll economic synthesis / pre-payroll
- Training
- Medical visits
- Documents
- Notifications / emails
- Permissions
- Audit logs

## Global architecture rules

Preserve entityId isolation.
Preserve Firebase Auth checks.
Preserve membership-based permissions.
Preserve audit logs for sensitive actions.
Preserve existing Firestore collection structure unless explicitly requested.
Do not change Firestore rules unless explicitly requested.
Do not modify unrelated modules.
Do not rename existing routes without explicit approval.
Do not delete existing fields unless a migration plan is provided.

## Git rules

Never commit unless explicitly requested.
Never push unless explicitly requested.
Never deploy unless explicitly requested.
Never work directly on main.
Current Codex branch should be:
codex/hr-italy-completion

For check-only tasks:
- do not modify files
- do not format files
- do not stage files
- do not commit
- do not push

## Validation commands

Always run before final response when code was changed:
- npm run typecheck
- npm run build

Also provide:
- git status --short
- git diff --stat
- git diff --name-only

## Payroll / economic synthesis rules

Payroll is an economic synthesis / pre-payroll module.
It is not an official payslip.
Do not call it official payroll, payslip, net salary, or bank salary.

Payroll must use:
- PayrollParameter only as employee-specific override
- CCNL Level / Livello for gross salary, hourly rate, and premiums
- CCNL Root for hourly divisor, standard weekly hours, weekly schedule, and monthly payments
- Holidays registry for public holiday detection

Forbidden in payroll:
- hardcoded divisor 173
- hardcoded overtime premium 30
- hardcoded weekly fallback 40h
- hardcoded premium values
- CCNL Root fallback for premiums
- ignoring holidays registry
- relying only on AttendanceRecord.holidayFlag
- changing pre-payroll into official payslip

Holiday detection must use:
attendance.holidayFlag === true OR holidays registry match by date.

Premium priority:
PayrollParameter override
→ CCNL Level / Livello value
→ null / warning

Hourly rate priority:
PayrollParameter override
→ CCNL Level grossHourly / minimumGrossHourly
→ grossMonthly / CCNL Root hourlyDivisor
→ null / warning

Weekly threshold priority:
contract weeklyHours
→ CCNL Root standardWeeklyHours
→ sum of CCNL Root weeklySchedule
→ null / warning

## Training module rules

Training module must preserve the existing baseline:
- plan training session
- select collaborators
- training type
- title
- duration
- provider
- status
- result / evaluation
- certificate attachment

New work must be incremental:
- training request workflow
- approval / rejection
- external coach email
- coach response tracking
- conversion from approved request to planned session

Emails must be previewable and editable before sending.

## Medical visits rules

Medical visit module must preserve medical confidentiality.

New work must be incremental:
- request available slots from external doctor / medical center
- editable email before sending
- doctor response tracking
- selected slot
- conversion into planned medical visit

Medical documents must remain visible only to authorized roles.

## Advances / debts rules

Employee advances and debts must support:
- salary advance request
- employee debt / internal loan request
- approval / rejection
- document generation
- signed document upload
- monthly repayment schedule
- monthly bank receipt / proof upload
- optional deduction impact in economic synthesis

Do not create payroll deductions without explicit approved request and repayment schedule.

## Tredicesima / quattordicesima rules

Tredicesima and quattordicesima must be configurable.
Do not hardcode payment months or formulas unless explicitly required.

System should support:
- eligibility by CCNL / Livello / contract
- monthly accrual / provision
- payment month
- economic synthesis impact
- separate tracking from ordinary monthly salary

This remains pre-payroll information, not official payroll.

## Documents rules

Documents must be linked to their source module.

Required metadata pattern:
- entityId
- employeeId when applicable
- relatedModule
- relatedId
- documentType
- status
- createdAt
- createdBy
- updatedAt
- updatedBy

Do not store sensitive medical documents in generic public areas.

## Email rules

Emails must be:
- previewable before sending
- editable before sending
- logged after send attempt
- linked to source module
- marked as sent or failed

Do not send hardcoded email content without template variables.

## Audit log rules

Sensitive actions must create audit events:
- request created
- request approved
- request rejected
- email sent
- document generated
- signed document uploaded
- payroll calculated
- repayment recorded
- medical visit planned
- certificate uploaded

## Expected workflow with Codex

For planning tasks:
Use PLAN ONLY.
Do not modify files.

For implementation tasks:
Use STRICT FIX ONLY.
Modify only requested scope.
Preserve existing behavior.

For verification tasks:
Use STRICT CHECK ONLY.
Do not modify files.

## Final response requirements

Always report:
1. Files changed
2. What was implemented
3. What was preserved
4. Typecheck result
5. Build result
6. Git status
7. Whether any commit/push/deploy was performed
