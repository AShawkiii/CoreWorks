/**
 * Fictional sample data content (Phase 19) — kept separate from the seeding
 * logic (SeedSampleData.gs) for readability. No real client or personal
 * information; all names/companies are invented.
 */

// One employee per template role (Bookkeeper, Senior Accountant, Account
// Manager, FP&A Analyst, CFO Advisor) so every generated task's role-based
// Default Assignee resolves to a real, matching employee.
var SAMPLE_EMPLOYEES = [
  { 'Employee Name': 'Morgan Reyes', 'Role': 'Account Manager', 'Department': 'Client Services', 'Email': 'morgan.reyes@financelab.example', 'Active?': 'Yes', 'Manager': '', 'Capacity': 12, 'Notes': '' },
  { 'Employee Name': 'Priya Anand', 'Role': 'Bookkeeper', 'Department': 'Accounting', 'Email': 'priya.anand@financelab.example', 'Active?': 'Yes', 'Manager': 'Morgan Reyes', 'Capacity': 20, 'Notes': '' },
  { 'Employee Name': 'Daniel Cho', 'Role': 'Senior Accountant', 'Department': 'Accounting', 'Email': 'daniel.cho@financelab.example', 'Active?': 'Yes', 'Manager': 'Morgan Reyes', 'Capacity': 15, 'Notes': '' },
  { 'Employee Name': 'Sofia Marchetti', 'Role': 'FP&A Analyst', 'Department': 'FP&A', 'Email': 'sofia.marchetti@financelab.example', 'Active?': 'Yes', 'Manager': 'Morgan Reyes', 'Capacity': 12, 'Notes': '' },
  { 'Employee Name': 'Grace Okafor', 'Role': 'CFO Advisor', 'Department': 'Advisory', 'Email': 'grace.okafor@financelab.example', 'Active?': 'Yes', 'Manager': 'Morgan Reyes', 'Capacity': 8, 'Notes': '' }
];

// 5 clients spanning all 3 packages and a mix of Contract Statuses
// (Active/Onboarding/On Hold) so dashboards have something of everything.
var SAMPLE_CLIENTS = [
  {
    'Client Name': 'Brightline Retail Co', 'Company Name': 'Brightline Retail LLC', 'Industry': 'Retail', 'Business Type': 'LLC',
    'Start Date': '2025-11-01', 'Service Package': 'Basic Accounting', 'Account Manager': 'Morgan Reyes', 'Backup Team Member': 'Priya Anand',
    'Client Contact': 'Alex Brightline', 'Email': 'alex@brightlineretail.example', 'Phone': '555-0101',
    'Accounting System': 'QuickBooks Online', 'Reporting Frequency': 'Monthly', 'Month-End Closing Date': 5,
    'Contract Status': 'Active', 'Priority': 'Medium', 'Notes': 'Multi-location retailer, 4 storefronts.'
  },
  {
    'Client Name': 'Solstice Manufacturing', 'Company Name': 'Solstice Manufacturing Inc', 'Industry': 'Manufacturing', 'Business Type': 'C-Corp',
    'Start Date': '2025-06-15', 'Service Package': 'Full Finance', 'Account Manager': 'Morgan Reyes', 'Backup Team Member': 'Daniel Cho',
    'Client Contact': 'Jamie Solstice', 'Email': 'jamie@solsticemfg.example', 'Phone': '555-0102',
    'Accounting System': 'NetSuite', 'Reporting Frequency': 'Monthly', 'Month-End Closing Date': 5,
    'Contract Status': 'Active', 'Priority': 'High', 'Notes': 'Growing production capacity, watch cash flow.'
  },
  {
    'Client Name': 'Nimbus Software Group', 'Company Name': 'Nimbus Software Group Inc', 'Industry': 'Technology', 'Business Type': 'C-Corp',
    'Start Date': '2024-09-01', 'Service Package': 'CFO / FP&A', 'Account Manager': 'Morgan Reyes', 'Backup Team Member': 'Grace Okafor',
    'Client Contact': 'Taylor Nimbus', 'Email': 'taylor@nimbussoftware.example', 'Phone': '555-0103',
    'Accounting System': 'QuickBooks Online', 'Reporting Frequency': 'Monthly', 'Month-End Closing Date': 5,
    'Contract Status': 'Active', 'Priority': 'Critical', 'Notes': 'Preparing for Series B — investor reporting is high stakes.'
  },
  {
    'Client Name': 'Harbor & Vine Hospitality', 'Company Name': 'Harbor & Vine LLC', 'Industry': 'Hospitality', 'Business Type': 'LLC',
    'Start Date': '2026-08-01', 'Service Package': 'Full Finance', 'Account Manager': 'Morgan Reyes', 'Backup Team Member': 'Daniel Cho',
    'Client Contact': 'Robin Harbor', 'Email': 'robin@harborandvine.example', 'Phone': '555-0104',
    'Accounting System': 'Xero', 'Reporting Frequency': 'Monthly', 'Month-End Closing Date': 5,
    'Contract Status': 'Onboarding', 'Priority': 'Medium', 'Notes': 'Just signed; onboarding checklist in progress.'
  },
  {
    'Client Name': 'Cedar Ridge Logistics', 'Company Name': 'Cedar Ridge Logistics LLC', 'Industry': 'Logistics', 'Business Type': 'LLC',
    'Start Date': '2025-02-01', 'Service Package': 'Basic Accounting', 'Account Manager': 'Morgan Reyes', 'Backup Team Member': 'Priya Anand',
    'Client Contact': 'Casey Ridge', 'Email': 'casey@cedarridgelogistics.example', 'Phone': '555-0105',
    'Accounting System': 'QuickBooks Online', 'Reporting Frequency': 'Monthly', 'Month-End Closing Date': 5,
    'Contract Status': 'On Hold', 'Priority': 'Low', 'Notes': 'Paused engagement while client restructures internally.'
  }
];

// 3 requests per client (15 total), spanning every Days Waiting bucket and
// a mix of open/closed statuses.
var SAMPLE_REQUEST_TEMPLATES = [
  { request: 'Send latest bank statements', daysAgo: 2, status: 'Requested' },
  { request: 'Confirm outstanding vendor invoices', daysAgo: 6, status: 'Partially Received' },
  { request: 'Provide payroll register for the period', daysAgo: 18, status: 'Requested' }
];

// 2 issues per client (10 total), spanning every severity and open/resolved.
var SAMPLE_ISSUE_TEMPLATES = [
  { issue: 'Client slow to respond to document requests', category: 'Communication', severity: 'Medium', status: 'Open' },
  { issue: 'Discrepancy found in prior-period reconciliation', category: 'Data Quality', severity: 'High', status: 'Open' }
];
