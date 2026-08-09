# Cloud Monitoring Alert Policies for Telegram Gifts Applet

variable "project_id" {
  type        = string
  description = "GCP Project ID"
}

variable "notification_channels" {
  type        = list(string)
  description = "List of Notification Channel IDs (e.g. email, slack)"
  default     = []
}

# 1. Cloud SQL: Too Many Connections
resource "google_monitoring_alert_policy" "sql_too_many_connections" {
  project      = var.project_id
  display_name = "Cloud SQL: High Connection Count"
  combiner     = "OR"
  conditions {
    display_name = "Connections > 80% of limit"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/network/connections\" AND resource.type=\"cloudsql_database\""
      comparison      = "COMPARISON_GT"
      threshold_value = 800 # adjust based on tier limit
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = var.notification_channels
}

# 2. Cloud SQL: Disk Full / High Storage Utilization
resource "google_monitoring_alert_policy" "sql_disk_full" {
  project      = var.project_id
  display_name = "Cloud SQL: Disk Almost Full"
  combiner     = "OR"
  conditions {
    display_name = "Disk utilization > 85%"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/disk/utilization\" AND resource.type=\"cloudsql_database\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = var.notification_channels
}

# 3. Cloud SQL: Failed Backups (Status Check)
# Trigger if a backup operation fails
resource "google_monitoring_alert_policy" "sql_failed_backups" {
  project      = var.project_id
  display_name = "Cloud SQL: Failed Backups"
  combiner     = "OR"
  conditions {
    display_name = "Backup Failed Events"
    condition_matched_log {
      filter = "resource.type=\"cloudsql_database\" AND logName=\"projects/${var.project_id}/logs/cloudaudit.googleapis.com%2Factivity\" AND protoPayload.methodName=\"cloudsql.instances.backup\" AND severity=\"ERROR\""
    }
  }
  notification_channels = var.notification_channels
}

# 4. Cloud SQL: Unavailability / Instance Down
resource "google_monitoring_alert_policy" "sql_instance_down" {
  project      = var.project_id
  display_name = "Cloud SQL: Instance Down"
  combiner     = "OR"
  conditions {
    display_name = "Instance State != RUNNABLE"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/up\" AND resource.type=\"cloudsql_database\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = var.notification_channels
}

# 5. Cloud SQL: Long Transactions / High Transaction Latency
resource "google_monitoring_alert_policy" "sql_long_transactions" {
  project      = var.project_id
  display_name = "Cloud SQL: Long Transactions / High Latency"
  combiner     = "OR"
  conditions {
    display_name = "Transaction latency > 2 seconds"
    condition_threshold {
      # Use PostgreSQL specific metrics if using Insights, or CPU wait
      filter          = "metric.type=\"cloudsql.googleapis.com/database/postgresql/transaction/duration\" AND resource.type=\"cloudsql_database\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2.0
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = var.notification_channels
}

# 6. Application: High Latency (Cloud Run)
resource "google_monitoring_alert_policy" "app_high_latency" {
  project      = var.project_id
  display_name = "App (Cloud Run): High Latency"
  combiner     = "OR"
  conditions {
    display_name = "P99 Latency > 1000ms"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1000
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
      }
    }
  }
  notification_channels = var.notification_channels
}

# 7. Application Custom Metric: Outbox Backlog Growth
# Note: This assumes you expose a custom metric or a log-based metric for outbox backlog size
resource "google_monitoring_alert_policy" "outbox_backlog_growth" {
  project      = var.project_id
  display_name = "App: Outbox Backlog Growth"
  combiner     = "OR"
  conditions {
    display_name = "Outbox Pending Events > 1000"
    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/outbox/pending_events\" AND resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1000
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
      }
    }
  }
  notification_channels = var.notification_channels
}

# 8. Application Custom Metric: Failed Outbox Events
resource "google_monitoring_alert_policy" "outbox_failed_events" {
  project      = var.project_id
  display_name = "App: Failed Outbox Events"
  combiner     = "OR"
  conditions {
    display_name = "Outbox Failed Processing > 0"
    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/outbox/failed_events_count\" AND resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
      }
    }
  }
  notification_channels = var.notification_channels
}
