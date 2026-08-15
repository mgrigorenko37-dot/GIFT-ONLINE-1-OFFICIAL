# Google Cloud Monitoring & Alerts Setup

В данном руководстве описано, как настроить и проверить метрики и уведомления (alerts) для production-окружения в Google Cloud.

## Отслеживаемые метрики

### 1. Cloud SQL (PostgreSQL)

- **CPU & RAM**: Использование процессора (`database/cpu/utilization`) и памяти (`database/memory/utilization`).
- **Storage**: Использование дискового пространства (`database/disk/utilization`).
- **IOPS**: Операции чтения/записи диска (`database/disk/read_ops_count`, `database/disk/write_ops_count`).
- **Active & Failed Connections**: Активные подключения и неудачные попытки подключения к базе данных.
- **Transaction Latency**: Задержки выполнения транзакций (Query Insights / `database/postgresql/transaction/duration`).
- **Rollback Count**: Количество откатов транзакций (`database/postgresql/transaction/commit_count` / `rollback_count`).
- **Backup & PITR/WAL Status**: Состояние резервных копий и архивации WAL (в логах Audit Logs).
- **Database Errors**: Ошибки на уровне СУБД (логи Cloud SQL).

### 2. Приложение (Cloud Run)

- **Transaction Latency (App level)**: Время обработки HTTP-запросов (`run.googleapis.com/request_latencies`).
- **CPU & RAM**: Потребление ресурсов контейнером.

### 3. Outbox Pattern (Custom Metrics)

- **Outbox Backlog**: Количество необработанных событий в таблице Outbox. (Необходимо экспортировать custom-метрику или использовать Log-based метрику по логам).
- **Failed Outbox Events**: Количество ошибок при попытке обработать outbox-события.

---

## Настройка Alerts (Уведомлений)

Для автоматического развертывания базовых политик оповещения подготовлен Terraform-конфиг.

### Способ 1: Использование Terraform

Файл с конфигурацией находится в: `terraform/monitoring.tf`.
В нем уже заложены политики:

1. **Слишком большое количество соединений** (Cloud SQL: High Connection Count)
2. **Заполнение диска** (Cloud SQL: Disk Almost Full, порог 85%)
3. **Failed backups** (Ошибки резервного копирования в Audit Logs)
4. **Недоступность Cloud SQL** (Instance State != RUNNABLE)
5. **Длительные транзакции / Высокая latency** (Postgres Transaction duration > 2s)
6. **Высокая latency приложения** (Cloud Run P99 Latency > 1s)
7. **Рост outbox backlog** (Custom metric > 1000)
8. **Failed outbox events** (Custom metric > 0 rate)

**Шаги для применения:**

```bash
cd terraform
# Инициализация terraform
terraform init

# Проверка плана (замените PROJECT_ID и EMAIL_CHANNEL_ID)
terraform plan -var="project_id=YOUR_PROJECT_ID" -var='notification_channels=["projects/YOUR_PROJECT_ID/notificationChannels/YOUR_CHANNEL_ID"]'

# Применение политик
terraform apply -var="project_id=YOUR_PROJECT_ID" -var='notification_channels=["projects/YOUR_PROJECT_ID/notificationChannels/YOUR_CHANNEL_ID"]'
```

### Способ 2: Настройка через Cloud Console (Графический интерфейс)

Если вы предпочитаете настраивать вручную в интерфейсе GCP:

1. Перейдите в **Monitoring -> Alerting**.
2. Создайте **Notification Channel** (например, Email или Slack).
3. Нажмите **Create Policy**.
4. Добавляйте условия (Conditions) по метрикам:
   - **Connections**: Resource = `Cloud SQL Database`, Metric = `Connections`. Сравнивайте с вашим лимитом.
   - **Outbox Backlog**: Сделайте запрос в приложении, который раз в минуту логирует размер backlog, и создайте Log-based Metric. Затем добавьте алерт на эту метрику (порог > 1000).
   - **Failed Backups**: Выберите `Log match` условие: `resource.type="cloudsql_database" AND protoPayload.methodName="cloudsql.instances.backup" AND severity="ERROR"`.
   - **Cloud SQL Availability**: Metric = `Database up`. Срабатывание при значении < 1.
   - **Long transactions**: Для Cloud SQL включите Query Insights. Добавьте алерт на метрику `database/postgresql/transaction/duration`.
   - **Disk full**: Metric = `Disk utilization`. Порог > 0.85 (85%).

### Способ 3: Экспорт кастомных метрик Outbox из приложения

Чтобы метрики `Outbox Backlog` и `Failed Outbox Events` работали, в приложении должен быть настроен экспорт метрик. Самый простой способ в среде Cloud Run — структурированное логирование (Structured Logging).

Пример логирования в TypeScript:

```typescript
// В фоновом воркере обработки outbox
console.log(
  JSON.stringify({
    severity: 'INFO',
    message: 'Outbox stats',
    outbox_pending_count: pendingCount,
    outbox_failed_events: failedCount,
  })
);
```

Затем в Cloud Logging перейдите в **Log-based Metrics** и создайте:

1. `outbox_pending_events` (тип: Distribution/Gauge, поле: `jsonPayload.outbox_pending_count`).
2. `outbox_failed_events_count` (тип: Counter, поле: `jsonPayload.outbox_failed_events`).

После этого созданные метрики станут доступны в Cloud Monitoring как `custom.googleapis.com/...`.
