/**
 * The Control Center's 6 charts.
 *
 * Charts are based on the QUERY blocks in CHART_SRC.
 * Existing managed charts are removed before rebuilding.
 */

function buildControlCenterCharts() {
  var ccSheet = getSheet('CONTROL_CENTER');
  var srcSheet = getSheet('CHART_SRC');

  removeManagedCharts(ccSheet);

  var chartSpecs = [
    {
      title: 'Client Progress',
      type: Charts.ChartType.COLUMN,
      blockIndex: 0
    },
    {
      title: 'Tasks by Status',
      type: Charts.ChartType.PIE,
      blockIndex: 1
    },
    {
      title: 'Tasks by Employee',
      type: Charts.ChartType.COLUMN,
      blockIndex: 2
    },
    {
      title: 'Overdue Tasks by Client',
      type: Charts.ChartType.BAR,
      blockIndex: 3
    },
    {
      title: 'Client Health Distribution',
      type: Charts.ChartType.PIE,
      blockIndex: 4
    },
    {
      title: 'Employee Workload',
      type: Charts.ChartType.COLUMN,
      blockIndex: 5
    }
  ];

  chartSpecs.forEach(function(spec, i) {

    var startCol =
      1 + spec.blockIndex * CHART_SRC_LAYOUT.BLOCK_COL_STRIDE;

    var dataRange = srcSheet.getRange(
      CHART_SRC_LAYOUT.QUERY_ROW,
      startCol,
      CHART_SRC_LAYOUT.DATA_ROWS,
      2
    );

    var anchorRow =
      CC_LAYOUT.CHARTS_START_ROW +
      Math.floor(i / 2) * CC_LAYOUT.CHART_ROW_SPAN;

    var anchorCol =
      1 + (i % 2) * CC_LAYOUT.CHART_COL_SPAN;

    var chart = ccSheet
      .newChart()
      .addRange(dataRange)
      .setChartType(spec.type)
      .setPosition(anchorRow, anchorCol, 0, 0)
      .setOption('title', spec.title)
      .setOption('legend', {
        position: 'right'
      })
      .setOption('width', 480)
      .setOption('height', 300)
      .build();

    ccSheet.insertChart(chart);
  });
}


/**
 * Removes charts managed by this system.
 */
function removeManagedCharts(sheet) {

  var titles = CC_LAYOUT.CHART_TITLES;

  sheet.getCharts().forEach(function(chart) {

    var chartTitle = chart
      .getOptions()
      .get('title');

    if (titles.indexOf(chartTitle) !== -1) {
      sheet.removeChart(chart);
    }

  });
}


/**
 * Diagnostic test for ChartType.
 */
function testChartType() {

  Logger.log('Charts object: ' + Charts);
  Logger.log('ChartType object: ' + Charts.ChartType);
  Logger.log('COLUMN: ' + Charts.ChartType.COLUMN);
  Logger.log('PIE: ' + Charts.ChartType.PIE);
  Logger.log('BAR: ' + Charts.ChartType.BAR);

}