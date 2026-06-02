import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/AuthContext';
import Layout from './components/Layout';

// Pages
import Login            from './pages/Login';
import StudentHome      from './pages/StudentHome';
import Assignments      from './pages/Assignments';
import EditAssignment   from './pages/EditAssignment';
import Rubrics          from './pages/Rubrics';
import Grading          from './pages/Grading';
import ManageUsers      from './pages/ManageUsers';
import ViewResult       from './pages/ViewResult';
import UploadAssignment from './pages/UploadAssignment';
import UploadPortfolio  from './pages/UploadPortfolio';
import ViewPortfolioList from './pages/ViewPortfolioList';
import GetFeedback      from './pages/GetFeedback';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected – all behind Layout (sidebar + auth guard) */}
          <Route element={<Layout />}>
            {/* Default redirect */}
            <Route index element={<Navigate to="/portfolio/list" replace />} />

            {/* Admin / Teacher routes */}
            <Route path="/portfolio/list"   element={<ViewPortfolioList />} />
            <Route path="/portfolio/upload" element={<UploadPortfolio />} />
            <Route path="/assignments"      element={<Assignments />} />
            <Route path="/assignments/edit/:id" element={<EditAssignment />} />
            <Route path="/rubrics"          element={<Rubrics />} />
            <Route path="/grading"          element={<Grading />} />
            <Route path="/users"            element={<ManageUsers />} />

            {/* Student routes */}
            <Route path="/student/home"     element={<StudentHome />} />
            <Route path="/student/upload"   element={<UploadAssignment />} />
            <Route path="/student/feedback" element={<GetFeedback />} />
            <Route path="/student/results"  element={<ViewResult />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
