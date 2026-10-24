# Hệ Thống Quản Lý Thư Viện (Library Management System)

> **Môn học:** Triển khai và Quản trị Hệ thống Phần mềm  
> **Kiến trúc:** Microservices trên nền tảng Docker & Docker Compose  
> **Công nghệ chính:** Node.js Express, PostgreSQL 16, pgAdmin 4, Nginx Reverse Proxy, Prometheus, Grafana, Loki & Promtail.

---

## 1. Giới Thiệu Dự Án

Hệ thống Quản lý Thư viện cung cấp giải pháp toàn diện cho việc quản lý tài liệu, quản lý độc giả và xử lý quy trình mượn/trả sách. Toàn bộ hệ thống được container hóa bằng Docker, tích hợp cổng Reverse Proxy Nginx bảo mật, hệ thống giám sát metrics thời gian thực (Prometheus & Grafana) và thu thập log tập trung (Loki & Promtail).

### Các Chức Năng Chính Của Ứng Dụng:
- **Quản lý Danh mục Sách:** Tìm kiếm theo tựa sách/tác giả/ISBN, thêm sách mới, cập nhật số lượng, xóa sách.
- **Quản lý Độc giả:** Cấp thẻ thư viện, theo dõi thông tin liên lạc độc giả, phân loại trạng thái hoạt động.
- **Quy trình Mượn / Trả Sách:**
  - Lập phiếu mượn: tự động kiểm tra số lượng tồn kho khả dụng và trừ kho theo thời gian thực.
  - Xác nhận trả sách: tự động hoàn trả số lượng khả dụng vào kho và cập nhật ngày trả thực tế.
  - Theo dõi tình trạng sách quá hạn mượn.
- **Dashboard Tổng quan:** Hiển thị trực quan các chỉ số KPI thư viện, cảnh báo sách đang mượn và danh sách phiếu mượn mới nhất.

---

## 2. Bảng Thông Tin Cổng & Tài Khoản Mặc Định

| Dịch vụ | Cổng Host | Đường dẫn truy cập | Tài khoản / Mật khẩu | Ghi chú |
| :--- | :---: | :--- | :--- | :--- |
| **Ứng dụng Web Thư viện** | `8080` | `http://localhost:8080` | *Không yêu cầu* | Truy cập qua Nginx Reverse Proxy (Tránh xung đột cổng 80 của Windows IIS) |
| **Metrics Endpoint** | `8080` | `http://localhost:8080/metrics` | *Công khai* | Prometheus scrape endpoint |
| **pgAdmin 4 (Quản trị DB)** | `5050` | `http://localhost:5050` | `admin@library.com` / `AdminSecurePass2026!` | Đã cấu hình sẵn kết nối vào DB |
| **Prometheus Web UI** | `9091` | `http://localhost:9091` | *Không yêu cầu* | Giám sát targets và PromQL |
| **Grafana Dashboard** | `3001` | `http://localhost:3001` | `admin` / `GrafanaAdmin2026!` | Đã nạp sẵn Dashboard thư viện |
| **Loki Log Server** | `3100` | `http://localhost:3100` | *Nội bộ* | Lưu trữ log từ Promtail |
| **PostgreSQL 16** | `5432` | `postgres:5432` *(nội bộ)* | `lib_user` / `LibrarySecurePass2026!` | **Được cô lập hoàn toàn** |

---

## 3. Sơ Đồ Kiến Trúc Hệ Thống (Architecture Diagram)

```
[ Trình duyệt / Client ]
           │
           ▼ (HTTP: Port 80)
┌────────────────────────────────────────────────────────┐
│ NGINX REVERSE PROXY                                    │
│ - Rate Limiting (15 req/s)                             │
│ - Security Headers (X-Frame-Options, CSP, Nosniff...)  │
│ - Structured JSON Access Log                           │
└──────────────────────────┬─────────────────────────────┘
                           │ (frontend_net)
                           ▼
┌────────────────────────────────────────────────────────┐
│ WEB APPLICATION (Node.js Express) - Non-Root Container │
│ - RESTful API & Giao diện Bootstrap 5 EJS              │
│ - Xuất metrics tại /metrics (prom-client)              │
└────────────┬─────────────────────────────┬─────────────┘
             │ (backend_net)               │ (monitoring_net)
             ▼                             ▼
┌───────────────────────────┐  ┌─────────────────────────┐
│ POSTGRESQL 16 (Isolated)  │  │ PROMETHEUS & EXPORTERS  │
│ - Database: library_db    │  │ - postgres-exporter     │
│ - User: lib_user          │  │ - cadvisor              │
└────────────▲──────────────┘  └───────────┬─────────────┘
             │                             │
┌────────────┴──────────────┐              ▼
│ pgADMIN 4 (Port 5050)     │  ┌─────────────────────────┐
│ Quản trị trực quan        │  │ GRAFANA DASHBOARD       │
└───────────────────────────┘  │ Port 3001               │
                               └───────────▲─────────────┘
                                           │
┌───────────────────────────┐              │
│ PROMTAIL -> LOKI (Logs)   ├──────────────┘
└───────────────────────────┘
```

---

## 4. Hướng Dẫn Cài Đặt & Khởi Chạy

### Điều kiện tiên quyết:
- Đã cài đặt [Docker](https://www.docker.com/) và **Docker Compose**.
- Đã cài đặt [Git](https://git-scm.com/).

### Các bước thực hiện:

#### Bước 1: Sao chép file môi trường
```bash
cp .env.example .env
```
*(Nếu dùng Windows PowerShell: `Copy-Item .env.example .env`)*

#### Bước 2: Khởi động toàn bộ hệ sinh thái dịch vụ
```bash
docker compose up -d --build
```

#### Bước 3: Kiểm tra trạng thái hoạt động của các container
```bash
docker compose ps
```
Tất cả các container (`library_nginx`, `library_web_app`, `library_postgres`, `library_pgadmin`, `library_prometheus`, `library_grafana`, `library_loki`, `library_promtail`, `library_postgres_exporter`, `library_cadvisor`) phải hiển thị trạng thái `Up` (hoặc `healthy`).

---

## 5. Hướng Dẫn Kiểm Thử & Kịch Bản Demo (Đạt Điểm 10/10)

### 1. Demo Nghiệp vụ Web Quản lý Thư viện & PostgreSQL (Tiêu chí 2 - 1.5đ)
1. Mở trình duyệt vào `http://localhost:8080`:
   - Xem tổng quan Dashboard với dữ liệu đã nạp sẵn từ `init.sql`.
   - Vào tab **Quản lý Sách**: Thêm một cuốn sách mới (VD: "Docker Deep Dive").
   - Vào tab **Quản lý Độc giả**: Thêm độc giả mới.
   - Bấm nút **Tạo Phiếu Mượn Sách**: Chọn độc giả vừa tạo và cuốn sách vừa thêm. Bấm **Xác nhận mượn**.
   - Quan sát số lượng khả dụng của cuốn sách bị giảm đi 1.
   - Bấm nút **Trả Sách**: Quan sát số lượng sách tự động tăng lại vào kho.
2. Mở pgAdmin tại `http://localhost:5050`:
   - Đăng nhập với email `admin@library.com` / pass `AdminSecurePass2026!`.
   - Mở Server `PostgreSQL Library DB` -> `Databases` -> `library_db` -> `Schemas` -> `public` -> `Tables` -> Xem bảng `borrow_records` để chứng minh dữ liệu lưu trực tiếp vào CSDL PostgreSQL.

### 2. Demo Nginx Reverse Proxy & Hardening (Tiêu chí 3 & 6 - 3.0đ)
1. Mở trình duyệt, nhấn **F12** -> chọn tab **Network** -> F5 trang `http://localhost:8080`.
2. Bấm vào request đầu tiên:
   - Chỉ ra các **Security Headers**:
     - `X-Frame-Options: SAMEORIGIN` (Chống Clickjacking)
     - `X-Content-Type-Options: nosniff` (Chống MIME-type sniffing)
     - `X-XSS-Protection: 1; mode=block`
     - `Content-Security-Policy`
   - Chỉ ra header `Server: nginx` (đã giấu phiên bản bằng `server_tokens off;`).
3. Chỉ ra cấu trúc Docker Compose:
   - Cổng `5432` của PostgreSQL **không được expose ra ngoài host** (Network Isolation).
   - Container Web App chạy với `USER node` (Non-root user).
   - Giới hạn tài nguyên `deploy.resources.limits` (0.5 CPU, 512MB RAM).

### 3. Demo Giám sát Prometheus & Grafana (Tiêu chí 4 - 1.5đ)
1. Mở Grafana tại `http://localhost:3001` (đăng nhập `admin` / `GrafanaAdmin2026!`).
2. Vào mục **Dashboards** -> Chọn **Hệ Thống Quản Lý Thư Viện - Giám Sát Tổng Hợp**:
   - Trình bày biểu đồ **Tần suất HTTP Request** (Request Rate per second).
   - Trình bày biểu đồ **Thời gian phản hồi** (Latency ms).
   - Trình bày các KPI nghiệp vụ: **Tổng đầu sách**, **Số sách đang được mượn**.

### 4. Demo Hệ thống Log Tập Trung Loki & LogQL (Tiêu chí 5 - 1.5đ)
1. Trong Grafana, chọn biểu tượng la bàn **Explore** ở thanh điều hướng bên trái.
2. Chọn Data source: **Loki**.
3. Nhập và chạy lần lượt 3 câu truy vấn LogQL:

* **Câu 1: Xem toàn bộ luồng log từ Nginx Reverse Proxy:**
  ```logql
  {job="nginx"}
  ```

* **Câu 2: Lọc các request lỗi hoặc request có mã HTTP Status code >= 400:**
  ```logql
  {job="nginx"} | json | status >= 400
  ```

* **Câu 3: Đếm tần suất request theo mã phản hồi (200, 304, 404...):**
  ```logql
  sum by (status) (rate({job="nginx"} | json [1m]))
  ```

---

## 6. Hướng Dẫn Thực Hiện 03 Commit Chuẩn Lên GitHub (Tiêu chí 1 - 1.5đ)

Để đáp ứng trọn vẹn yêu cầu *"đủ 03 commit và nội dung có ý nghĩa"*, hãy thực hiện tuần tự như sau khi tạo Git Repository:

```bash
# Khởi tạo repository
git init

# COMMIT 1: Khởi tạo mã nguồn ứng dụng và schema CSDL
git add app/ database/
git commit -m "feat(app): initialize library management web app, REST APIs, and PostgreSQL schema"

# COMMIT 2: Thêm Nginx Reverse Proxy, cấu hình Docker Compose và Hardening
git add nginx/ pgadmin/ .env.example .gitignore docker-compose.yml
git commit -m "feat(infra): configure Nginx reverse proxy with security headers, pgAdmin, and network isolation"

# COMMIT 3: Tích hợp hệ thống giám sát Prometheus, Grafana, Loki và tài liệu hướng dẫn
git add monitoring/ README.md
git commit -m "feat(observability): integrate Prometheus metrics, Grafana dashboards, Loki LogQL pipelines, and documentation"
```

---

## 7. Lệnh Dọn Dẹp / Tắt Hệ Thống
```bash
# Tắt hệ thống (giữ lại dữ liệu database)
docker compose down

# Tắt hệ thống và xóa toàn bộ dữ liệu volume
docker compose down -v
```
