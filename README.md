# AIAGS - AI Assignment Grading System

AIAGS is a full-stack assignment grading system with a React frontend, an Express/MySQL backend, and a FastAPI-based ML service.

## Tech Stack

- Frontend: React 18, Vite, React Router
- Backend: Node.js, Express, MySQL
- ML service: FastAPI, scikit-learn, pandas, PyMuPDF/pdfplumber, Ollama
- Authentication: JWT-based backend authentication

## Project Structure

```text
AIAGS_React/
├── frontend/      # React app
├── backend/       # Express API, MySQL schema, uploads handling
├── ml_service/    # FastAPI service and ML model
└── README.md
```

## Prerequisites

- Node.js 18+
- npm
- Python 3.10+
- MySQL
- Ollama, if using the ML service features that call Ollama

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run dev
```

The backend runs on `http://localhost:4000` by default.

Update `backend/.env` with your local database credentials:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=aigs_db
JWT_SECRET=replace_with_a_strong_secret
PORT=4000
CORS_ORIGIN=http://localhost:3000
ML_SERVICE_URL=http://localhost:5000
UPLOAD_DIR=./uploads
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:3000`.

### 3. ML Service

```bash
cd ml_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 5000
```

The ML service runs on `http://localhost:5000`.

## Database

Create the database before running migrations:

```bash
mysql -u root -p -e "CREATE DATABASE aigs_db;"
```

Then run:

```bash
cd backend
npm run migrate
```

## Production Build

```bash
cd frontend
npm run build

cd ../backend
npm start
```

## Main Routes

| Route | Page |
| --- | --- |
| `/login` | Login |
| `/portfolio/list` | Portfolio List |
| `/portfolio/upload` | Upload Portfolio |
| `/assignments` | Manage Assignments |
| `/rubrics` | Manage Rubrics |
| `/grading` | AI Grading |
| `/users` | Manage Users |
| `/student/home` | Student Dashboard |
| `/student/upload` | Upload Assignment |
| `/student/feedback` | Get AI Feedback |
| `/student/results` | View Results |

## Git Notes

The repository intentionally ignores generated dependencies, local environment files, virtual environments, build output, caches, logs, and uploaded documents. Keep `backend/.env.example` committed, but never commit `backend/.env`.
