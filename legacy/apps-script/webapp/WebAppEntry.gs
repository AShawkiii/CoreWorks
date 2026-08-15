/**
 * Finance Lab Client Delivery Web App
 *
 * Web App entry point.
 *
 * IMPORTANT:
 * - Uses HtmlService.createTemplateFromFile() so Apps Script
 *   template variables can be injected into Index.html.
 * - Index.html and AccessDenied.html are fully self-contained.
 *
 * Access control:
 * - Uses the existing EMPLOYEES sheet as the source of truth.
 * - User must have a matching Email.
 * - User must have Active? = Yes.
 *
 * No existing backend/business logic is modified.
 */


/**
 * Main Web App entry point.
 *
 * @param {Object} e Apps Script event object.
 * @return {HtmlOutput}
 */
function doGet(e) {

  var email = getRequestingUserEmail();
  var access = checkWebAppAccess(email);

  // ------------------------------------------------------------
  // ACCESS DENIED
  // ------------------------------------------------------------

  if (!access.allowed) {

    var deniedTemplate =
      HtmlService.createTemplateFromFile(
        'webapp/AccessDenied'
      );

    deniedTemplate.requestingEmail =
      email || '(no email available)';

    return deniedTemplate
      .evaluate()
      .setTitle('Finance Lab - Access Restricted')
      .addMetaTag(
        'viewport',
        'width=device-width, initial-scale=1'
      );
  }


  // ------------------------------------------------------------
  // AUTHORIZED USER
  // ------------------------------------------------------------

  var template =
    HtmlService.createTemplateFromFile(
      'webapp/Index'
    );


  // Pass authenticated user information
  // into the HTML template.

  template.currentUserEmail =
    email || '';

  template.currentUserName =
    (
      access.employee &&
      access.employee['Employee Name']
    )
      ? access.employee['Employee Name']
      : (email || 'User');


  // ------------------------------------------------------------
  // EVALUATE TEMPLATE
  // ------------------------------------------------------------

  return template
    .evaluate()
    .setTitle('Finance Lab - Client Delivery')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1'
    );
}


/**
 * Returns the email address of the current user.
 *
 * IMPORTANT:
 * Session.getActiveUser().getEmail() depends on the
 * Web App deployment and access configuration.
 *
 * @return {String}
 */
function getRequestingUserEmail() {

  try {

    var email =
      Session
        .getActiveUser()
        .getEmail();

    if (!email) {
      return '';
    }

    return String(email)
      .trim()
      .toLowerCase();

  } catch (err) {

    console.error(
      'Unable to determine requesting user email: ' +
      err.message
    );

    return '';
  }
}


/**
 * Checks whether a user is authorized to access
 * the Web App.
 *
 * Source of truth:
 * EMPLOYEES sheet
 *
 * Required:
 * - Email matches current Google account
 * - Active? = Yes
 *
 * @param {String} email
 *
 * @return {{
 *   allowed: Boolean,
 *   employee: Object|null
 * }}
 */
function checkWebAppAccess(email) {

  // ------------------------------------------------------------
  // Validate email
  // ------------------------------------------------------------

  if (!email) {

    return {
      allowed: false,
      employee: null
    };
  }


  var normalizedEmail =
    String(email)
      .trim()
      .toLowerCase();


  try {

    // ----------------------------------------------------------
    // Load employees
    // ----------------------------------------------------------

    var employees =
      getAllRows('EMPLOYEES');


    if (
      !employees ||
      !employees.length
    ) {

      return {
        allowed: false,
        employee: null
      };
    }


    // ----------------------------------------------------------
    // Find authorized employee
    // ----------------------------------------------------------

    var employee =
      employees.filter(function (employeeRow) {

        if (!employeeRow) {
          return false;
        }


        var employeeEmail =
          String(
            employeeRow['Email'] || ''
          )
            .trim()
            .toLowerCase();


        var active =
          String(
            employeeRow['Active?'] || ''
          )
            .trim()
            .toLowerCase();


        return (
          employeeEmail === normalizedEmail &&
          active === 'yes'
        );

      })[0];


    // ----------------------------------------------------------
    // Employee not found / inactive
    // ----------------------------------------------------------

    if (!employee) {

      return {
        allowed: false,
        employee: null
      };
    }


    // ----------------------------------------------------------
    // Authorized
    // ----------------------------------------------------------

    return {
      allowed: true,
      employee: employee
    };


  } catch (err) {

    // ----------------------------------------------------------
    // FAIL CLOSED
    // ----------------------------------------------------------
    //
    // If EMPLOYEES cannot be read or validated,
    // access is denied.
    //

    console.error(
      'Web App access check failed: ' +
      err.message
    );


    return {
      allowed: false,
      employee: null
    };
  }
}