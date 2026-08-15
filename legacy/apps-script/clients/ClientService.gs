/**
 * IO wrapper around ClientLogic.gs — createNewClient() is Phase 6's
 * onboarding automation: validate, assign an ID, generate onboarding tasks
 * from the client's Service Package templates, log it, and prime progress/
 * health so dashboards are correct the instant the client is added.
 */

/**
 * Creates a new client, generates its onboarding tasks, and returns the
 * created CLIENTS row. Rejects a client whose Name + Company Name already
 * match an existing row (architecture.md §7). Defaults Contract Status to
 * 'Onboarding' and Client Health to 'On Track' if not supplied.
 */
function createNewClient(fields) {
  var validation = validateClientFields(fields);
  if (!validation.valid) {
    throw new Error('createNewClient(): invalid client fields — ' + validation.errors.join(' '));
  }

  var existingClients = getAllRows('CLIENTS');
  if (isDuplicateClient(fields, existingClients)) {
    throw new Error('createNewClient(): a client named "' + fields['Client Name'] + '" at "' + fields['Company Name'] + '" already exists.');
  }

  var client = Object.assign({}, fields);
  client['Client ID'] = generateNextId('CLIENTS');
  client['Contract Status'] = client['Contract Status'] || 'Onboarding';
  client['Priority'] = client['Priority'] || 'Medium';
  client['Client Health'] = client['Client Health'] || 'On Track';
  client['Simple Completion %'] = 0;
  client['Weighted Completion %'] = 0;
  client['Next Deadline'] = '';

  appendRow('CLIENTS', client);
  logActivity('Client Added', 'Client', client['Client ID'], '', client['Client Name'], client['Client Name']);

  var onboardingResult = generateOnboardingTasks(client['Client ID'], client['Service Package']);

  recalculateClientProgress(client['Client ID']);
  recalculateClientHealth(client['Client ID']);

  return { client: client, tasksCreated: onboardingResult.tasksCreated };
}
