// Check CronJob statuses
// Usage: hac groovy --file cronjob-status.groovy

import de.hybris.platform.cronjob.enums.CronJobStatus
import de.hybris.platform.cronjob.enums.CronJobResult

def query = "SELECT {pk},{code},{status},{result},{startTime},{endTime} FROM {CronJob} ORDER BY {startTime} DESC"
def result = flexibleSearchService.search(query)

result.result.take(20).each { job ->
  def status = job.status?.code ?: 'UNKNOWN'
  def res    = job.result?.code  ?: 'N/A'
  def icon   = status == 'FINISHED' ? (res == 'SUCCESS' ? '✓' : '✗') : '⟳'
  println "${icon} [${status}/${res}] ${job.code}  start:${job.startTime}"
}

return "Last ${Math.min(20, result.result.size())} cron jobs"
