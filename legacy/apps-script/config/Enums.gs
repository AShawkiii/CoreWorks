/**
 * Canonical enumerations. Values marked code-significant in architecture.md §5
 * are compared with === inside *Logic.gs files — relabeling them in SETTINGS
 * without updating this file will break automation (documented in admin-guide.md).
 *
 * Each entry: { values: [...], colors: { value: '#hex' }, weights?: { value: number } }
 * `colors` drives conditional formatting; `weights` drives weighted completion.
 */
var ENUMS = {
  TASK_STATUS: {
    values: ['Not Started', 'In Progress', 'Waiting Client', 'Blocked', 'In Review', 'Completed', 'Cancelled'],
    colors: {
      'Not Started': '#f1f3f4',
      'In Progress': '#cfe2ff',
      'Waiting Client': '#fff3cd',
      'Blocked': '#f8d7da',
      'In Review': '#e2d9f3',
      'Completed': '#d4edda',
      'Cancelled': '#e9ecef'
    },
    open: ['Not Started', 'In Progress', 'Waiting Client', 'Blocked', 'In Review'],
    closed: ['Completed', 'Cancelled']
  },

  PRIORITY: {
    values: ['Low', 'Medium', 'High', 'Critical'],
    colors: {
      'Low': '#d4edda',
      'Medium': '#fff3cd',
      'High': '#ffe0b2',
      'Critical': '#f8d7da'
    },
    weights: { 'Low': 1, 'Medium': 2, 'High': 3, 'Critical': 4 }
  },

  CLIENT_HEALTH: {
    values: ['On Track', 'At Risk', 'Delayed', 'On Hold'],
    emoji: { 'On Track': '🟢', 'At Risk': '🟡', 'Delayed': '🔴', 'On Hold': '⚪' },
    colors: {
      'On Track': '#d4edda',
      'At Risk': '#fff3cd',
      'Delayed': '#f8d7da',
      'On Hold': '#e9ecef'
    }
  },

  CONTRACT_STATUS: {
    values: ['Onboarding', 'Active', 'On Hold', 'Completed', 'Cancelled']
  },

  REQUEST_STATUS: {
    values: ['Requested', 'Partially Received', 'Received', 'Not Available', 'Cancelled'],
    colors: {
      'Requested': '#cfe2ff',
      'Partially Received': '#fff3cd',
      'Received': '#d4edda',
      'Not Available': '#e9ecef',
      'Cancelled': '#e9ecef'
    },
    open: ['Requested', 'Partially Received'],
    closed: ['Received', 'Not Available', 'Cancelled']
  },

  DAYS_WAITING_BUCKET: {
    values: ['0-3', '4-7', '8-14', '15+']
  },

  ISSUE_SEVERITY: {
    values: ['Low', 'Medium', 'High', 'Critical'],
    colors: {
      'Low': '#d4edda',
      'Medium': '#fff3cd',
      'High': '#ffe0b2',
      'Critical': '#f8d7da'
    }
  },

  ISSUE_STATUS: {
    values: ['Open', 'In Progress', 'Resolved', 'Cancelled'],
    colors: {
      'Open': '#f8d7da',
      'In Progress': '#cfe2ff',
      'Resolved': '#d4edda',
      'Cancelled': '#e9ecef'
    },
    open: ['Open', 'In Progress'],
    closed: ['Resolved', 'Cancelled']
  },

  REVIEW_STATUS: {
    values: ['Not Reviewed', 'In Review', 'Approved', 'Changes Requested']
  },

  FREQUENCY: {
    values: ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'One-Time']
  },

  REPORTING_FREQUENCY: {
    values: ['Weekly', 'Monthly', 'Quarterly']
  },

  CLOSE_STAGE_STATUS: {
    values: ['Not Started', 'In Progress', 'Completed', 'Blocked', 'Waiting Client'],
    colors: {
      'Not Started': '#f1f3f4',
      'In Progress': '#cfe2ff',
      'Completed': '#d4edda',
      'Blocked': '#f8d7da',
      'Waiting Client': '#fff3cd'
    }
  },

  CLOSE_STATUS: {
    values: ['Not Started', 'In Progress', 'Blocked', 'Closed']
  },

  ACTIVE_FLAG: {
    values: ['Yes', 'No'],
    colors: { 'Yes': '#d4edda', 'No': '#e9ecef' }
  },

  SERVICE_PACKAGE_NAME: {
    values: ['Basic Accounting', 'Full Finance', 'CFO / FP&A']
  },

  ENTITY_TYPE: {
    values: ['Client', 'Employee', 'Task', 'Task Template', 'Client Request', 'Issue', 'Monthly Close', 'System']
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ENUMS: ENUMS };
}
