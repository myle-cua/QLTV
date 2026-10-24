# Dockerfile cho Ứng Dụng Web Quản Lý Thư Viện (Hardened Non-Root Container)
FROM node:20-alpine

# Thiết lập thư mục làm việc
WORKDIR /usr/src/app

# Cài đặt curl để hỗ trợ container healthcheck nếu cần
RUN apk --no-cache add curl

# Copy file định nghĩa phụ thuộc
COPY package*.json ./

# Cài đặt các gói phụ thuộc production
RUN npm install --omit=dev

# Copy toàn bộ mã nguồn
COPY . .

# =======================================================
# HARDENING (Tiêu chí 6): Chuyển quyền sở hữu cho user 'node'
# Không chạy ứng dụng dưới quyền root (Non-root user)
# =======================================================
RUN chown -R node:node /usr/src/app
USER node

# Mở cổng ứng dụng nội bộ
EXPOSE 3000

# Khởi chạy ứng dụng
CMD ["node", "server.js"]
