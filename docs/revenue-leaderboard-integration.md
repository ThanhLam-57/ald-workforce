# API bảng xếp hạng doanh số hiện tại

## Phạm vi

API này chỉ dành cho backend/serverless của website bảng xếp hạng. Trình duyệt không gọi trực
tiếp và token thô không được đưa vào JavaScript phía client.

- Endpoint: `GET /api/integrations/v1/revenue-leaderboard/current`
- Tháng: tháng nghiệp vụ hiện tại theo `Asia/Ho_Chi_Minh`
- Đơn vị: `COIN`, scale `1`
- Phạm vi công ty: cố định từ cấu hình server
- Cache tại ALD: `no-store`
- Tần suất khuyến nghị cho website tiêu thụ: tối đa một lần mỗi 60 giây

Endpoint không nhận query parameter. `companyId`, `branchId` và `month` đều không thể được
chọn từ phía client.

## Cấu hình Railway

Ba biến dưới đây là tùy chọn đối với ứng dụng nói chung. Khi thiếu hoặc khi API bị tắt, chỉ
endpoint tích hợp trả `503`; các chức năng khác vẫn hoạt động.

```dotenv
REVENUE_LEADERBOARD_ENABLED=false
REVENUE_LEADERBOARD_COMPANY_ID=<company-uuid>
REVENUE_LEADERBOARD_TOKEN_SHA256=<64-character-sha256-hex>
```

Công ty được cấu hình phải dùng timezone `Asia/Ho_Chi_Minh`, `revenueUnit=COIN` và
`revenueScale=1`. API fail-closed nếu cấu hình công ty hoặc dữ liệu doanh số không khớp.

Tạo token ngẫu nhiên và SHA-256 bằng Node.js trên máy quản trị:

```powershell
node -e "const c=require('node:crypto');const token=c.randomBytes(32).toString('base64url');console.log('TOKEN='+token);console.log('SHA256='+c.createHash('sha256').update(token).digest('hex'))"
```

- Lưu `TOKEN` thô vào secret của backend website tiêu thụ.
- Chỉ lưu `SHA256` vào Railway của ALD.
- Không commit hoặc ghi token thô vào log, ảnh chụp, ticket hay tài liệu.

## Gọi API

```http
GET /api/integrations/v1/revenue-leaderboard/current HTTP/1.1
Authorization: Bearer <integration-token>
```

Response thành công:

```json
{
  "data": {
    "month": "2026-10",
    "timezone": "Asia/Ho_Chi_Minh",
    "unit": "COIN",
    "generatedAt": "2026-10-28T08:30:00.000Z",
    "totalEmployees": 1,
    "items": [
      {
        "rank": 1,
        "staffCode": "NV_XT_017",
        "displayName": "Hoài Live",
        "branches": [{ "code": "XT", "name": "Cơ sở Xuân Thủy" }],
        "revenue": "25800000"
      }
    ]
  }
}
```

`revenue` luôn là chuỗi số nguyên để không mất chính xác `BIGINT`.

Các mã lỗi chính:

- `400 UNSUPPORTED_QUERY`: request có query parameter.
- `401 UNAUTHORIZED`: thiếu hoặc sai Bearer token.
- `405 METHOD_NOT_ALLOWED`: phương thức khác GET.
- `503 INTEGRATION_UNAVAILABLE`: API tắt, cấu hình thiếu hoặc dữ liệu không an toàn để trả.
- `500 INTERNAL_ERROR`: lỗi bất ngờ; response không chứa chi tiết nội bộ.

Mọi response có `Cache-Control: no-store`, `Vary: Authorization` và `x-request-id`. API không
trả CORS header.

## Luật dữ liệu

- Chỉ lấy phân công `MEMBER` chưa archive có khoảng hiệu lực giao với tháng hiện tại.
- Người vào hoặc nghỉ giữa tháng vẫn được tính; người đã hết phân công trước đầu tháng bị loại.
- Nhân viên hợp lệ nhưng chưa có doanh số vẫn xuất hiện với doanh số `"0"`.
- Chỉ cộng `LiveDailyMetric.revenueAmount` của `AttendanceDay` chưa archive.
- Nhân viên chuyển cơ sở được cộng theo ngày công một lần và có danh sách các cơ sở giao với tháng.
- Đồng doanh số dùng dense ranking (`1, 1, 2`); `staffCode` chỉ là tie-break cho thứ tự ổn định.
- Tên hiển thị ưu tiên `streamingAlias`, sau đó tên che bớt, cuối cùng `staffCode`.
- DTO không chứa UUID nội bộ, email, điện thoại, CCCD, địa chỉ, lương, ngân hàng, payroll hay
  dữ liệu vi phạm.

## Tích hợp website ngoài

Backend website ngoài nên:

1. Đặt timeout ngắn cho request.
2. Gọi API tối đa khoảng một lần mỗi 60 giây.
3. Cache response tốt gần nhất ở phía server theo endpoint/công ty.
4. Khi ALD tạm lỗi, giữ bản tốt gần nhất và hiển thị `generatedAt` thay vì gọi dồn dập.
5. Chỉ chuyển đúng các trường cần hiển thị xuống frontend; không chuyển Bearer token.

## Phát hành và rollback

1. Deploy code với `REVENUE_LEADERBOARD_ENABLED=false`.
2. Cấu hình company ID và token hash ở staging.
3. Bật staging, đối chiếu tổng doanh số với báo cáo nội bộ cùng tháng.
4. Cấu hình backend website tiêu thụ rồi mới bật production.

Để khóa API ngay lập tức, đặt:

```dotenv
REVENUE_LEADERBOARD_ENABLED=false
```

API không có migration và không ghi dữ liệu nên rollback không cần thao tác database.
