# SSK ERP

**Right now it runs as a demo with no server or database:** `npm install && npm run dev`, then open http://localhost:5175. Data is saved in your browser.

Commission and CMS system. The first part is the **Setup page**, which admins complete before the first deal is entered: company profile, branches, deal types, tier ladder, upline levels and split, total payout per tier (company-wide with branch overrides), and case/voucher numbering.

## Requirements
- Node.js 22.12 or newer
- MySQL 8

## First run
```sh
# 1. Create the database
mysql -u root -e "CREATE DATABASE ssk_erp CHARACTER SET utf8mb4"

# 2. Backend
cd backend
cp .env.example .env        # fill in DB_PASSWORD; set ADMIN_TOKEN for production
npm install
npm run migrate
npm run dev                 # http://localhost:3002

# 3. Frontend (second terminal, project root)
npm install
npm run dev                 # http://localhost:5175
```

For a laptop demo with no MySQL, set `DB_CLIENT=sqlite` in `backend/.env`. Set `AUTH_DISABLED=true` to skip sign-in.

- `cd backend && npm run demo-data`: fill Setup with sample data
- `cd backend && npm run reset-db`: wipe back to blank
- `npm test`: payout rule tests
