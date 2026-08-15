/**
 * Seeds realistic fictional sample data (Phase 19): 5 employees, 5 clients
 * across all 3 packages and a mix of Contract Statuses, 50+ tasks (via real
 * onboarding + monthly generation, so the automation itself is exercised —
 * not hand-inserted rows), 15 client requests across every Days Waiting
 * bucket, and 10 issues across every severity. Idempotent via a SETTINGS
 * flag (CONST.SAMPLE_DATA_SEEDED_KEY) — safe to call setupSpreadsheet()
 * (and therefore this) more than once without doubling the data.
 */
function seedSampleData() {
  var alreadySeeded = getSetting('SYSTEM', CONST.SAMPLE_DATA_SEEDED_KEY, 'No') === 'Yes';
  if (alreadySeeded) {
    Logger.log('seedSampleData(): already seeded, skipping.');
    return { skipped: true };
  }

  appendRows('EMPLOYEES', SAMPLE_EMPLOYEES);

  var createdClients = SAMPLE_CLIENTS.map(function (fields) {
    return createNewClient(fields).client;
  });

  var today = new Date();
  var nextPeriod = formatPeriod(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  generateMonthlyTasks(nextPeriod);

  pushSampleTasksIntoVariedStates(createdClients);
  seedSampleRequests(createdClients, today);
  seedSampleIssues(createdClients, today);

  recalculateAllClientsProgress();
  recalculateAllClientsHealth();
  renderControlCenter();
  buildControlCenterCharts();
  renderTeamDashboard();
  generateMonthlyManagementReport();

  updateRowById('SETTINGS', 'Setting Key', CONST.SAMPLE_DATA_SEEDED_KEY, { 'Value': 'Yes' });
  logActivity('Sample Data Seeded', 'System', formatPeriod(today), '', createdClients.length + ' clients, sample requests/issues', '');

  return { skipped: false, clientsCreated: createdClients.length };
}

/** Manually pushes a handful of tasks into Overdue/Blocked/Critical states so dashboards have something to show on first open. */
function pushSampleTasksIntoVariedStates(clients) {
  clients.forEach(function (client, clientIndex) {
    var tasks = getTasksForClient(client['Client ID']);
    if (!tasks.length) return;

    // Every client: one task overdue and In Progress.
    var overdueTask = tasks[0];
    updateRowById('TASKS', 'Task ID', overdueTask['Task ID'], {
      'Status': 'In Progress',
      'Due Date': new Date(2020, 0, 1)
    });

    // Every other client: one task Blocked with a "Waiting For" note.
    if (clientIndex % 2 === 0 && tasks.length > 1) {
      updateRowById('TASKS', 'Task ID', tasks[1]['Task ID'], {
        'Status': 'Blocked',
        'Waiting For': 'Client to confirm prior-period balances'
      });
    }

    // One client: a Critical-priority task overdue, to exercise the Delayed health rule.
    if (clientIndex === 1 && tasks.length > 2) {
      updateRowById('TASKS', 'Task ID', tasks[2]['Task ID'], {
        'Status': 'In Progress',
        'Priority': 'Critical',
        'Due Date': new Date(2020, 0, 1)
      });
    }

    // One client: a task Waiting Client.
    if (tasks.length > 3) {
      updateRowById('TASKS', 'Task ID', tasks[3]['Task ID'], { 'Status': 'Waiting Client' });
    }

    // A handful of tasks marked Completed on every client, so progress %
    // and dashboards show realistic partial completion rather than 0%.
    tasks.slice(4, 4 + Math.min(3, tasks.length - 4)).forEach(function (t) {
      updateRowById('TASKS', 'Task ID', t['Task ID'], {
        'Status': 'Completed',
        'Completion Date': new Date(),
        'Completion %': 1
      });
    });
  });
}

function seedSampleRequests(clients, today) {
  clients.forEach(function (client) {
    SAMPLE_REQUEST_TEMPLATES.forEach(function (t) {
      var requestedDate = new Date(today.getTime() - t.daysAgo * 24 * 60 * 60 * 1000);
      createClientRequest({
        'Client ID': client['Client ID'],
        'Client': client['Client Name'],
        'Request': t.request,
        'Requested Date': requestedDate,
        'Required By': '',
        'Status': t.status,
        'Priority': 'Medium',
        'Assigned To': client['Account Manager']
      });
    });
  });

  // Demonstrate the "Received" path (closed, excluded from outstanding counts) on one request.
  var firstClientRequests = getAllRows('CLIENT_REQUESTS').filter(function (r) { return r['Client ID'] === clients[0]['Client ID']; });
  if (firstClientRequests.length) {
    updateRequestStatus(firstClientRequests[0]['Request ID'], 'Received', today);
  }
}

function seedSampleIssues(clients, today) {
  clients.forEach(function (client, clientIndex) {
    SAMPLE_ISSUE_TEMPLATES.forEach(function (t) {
      createIssue({
        'Client ID': client['Client ID'],
        'Client': client['Client Name'],
        'Issue': t.issue,
        'Category': t.category,
        'Severity': t.severity,
        'Status': t.status,
        'Impact': 'Delays monthly close.',
        'Required Action': 'Follow up with client contact.',
        'Assigned To': client['Account Manager']
      });
    });
  });

  // One Critical, overdue-deadline issue on the CFO/FP&A client — exercises the Delayed health rule and Control Center surfacing.
  createIssue({
    'Client ID': clients[2]['Client ID'],
    'Client': clients[2]['Client Name'],
    'Issue': 'Suspected duplicate vendor payment',
    'Category': 'Data Quality',
    'Severity': 'Critical',
    'Status': 'Open',
    'Impact': 'Potential cash leakage; needs investor-reporting-ready resolution.',
    'Required Action': 'Reconcile vendor ledger and confirm with bank.',
    'Deadline': new Date(2020, 0, 1),
    'Assigned To': clients[2]['Account Manager']
  });

  // One Resolved issue, to exercise the closed-issue exclusion path.
  var resolved = createIssue({
    'Client ID': clients[3]['Client ID'],
    'Client': clients[3]['Client Name'],
    'Issue': 'Missing prior accountant handoff notes',
    'Category': 'Onboarding',
    'Severity': 'Low',
    'Status': 'Open',
    'Impact': 'Minor — reconstructed from bank records.',
    'Required Action': 'None further.',
    'Assigned To': clients[3]['Account Manager']
  });
  resolveIssue(resolved['Issue ID'], today);
}
