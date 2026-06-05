import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './components/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { homeForRole } from './utils/roles';

// Pages
import Login            from './pages/Login';
import StudentHome      from './pages/StudentHome';
import Assignments      from './pages/Assignments';
import EditAssignment   from './pages/EditAssignment';
import Rubrics          from './pages/Rubrics';
import Grading          from './pages/Grading';
import ManageUsers      from './pages/ManageUsers';
import AssignLecturers  from './pages/AssignLecturers';
import ViewResult       from './pages/ViewResult';
import UploadAssignment from './pages/UploadAssignment';
import UploadPortfolio  from './pages/UploadPortfolio';
import ViewPortfolioList from './pages/ViewPortfolioList';
import GetFeedback      from './pages/GetFeedback';
import AccessDenied     from './pages/AccessDenied';

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homeForRole(user?.role)} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<Layout />}>
            <Route index element={<HomeRedirect />} />
            <Route path="/access-denied" element={<AccessDenied />} />

            <Route element={<ProtectedRoute roles={['admin', 'teacher']} />}>
              <Route path="/portfolio/list" element={<ViewPortfolioList />} />
              <Route path="/assignments" element={<Assignments />} />
              <Route path="/assignments/edit/:id" element={<EditAssignment />} />
              <Route path="/rubrics" element={<Rubrics />} />
              <Route path="/grading" element={<Grading />} />
            </Route>

            <Route element={<ProtectedRoute roles={['admin']} />}>
              <Route path="/assign-lecturers" element={<AssignLecturers />} />
              <Route path="/portfolio/upload" element={<UploadPortfolio />} />
              <Route path="/users" element={<ManageUsers />} />
            </Route>

            <Route element={<ProtectedRoute roles={['student']} />}>
              <Route path="/student/home" element={<StudentHome />} />
              <Route path="/student/upload" element={<UploadAssignment />} />
              <Route path="/student/submission/:assignmentId/edit" element={<UploadAssignment />} />
              <Route path="/student/feedback" element={<GetFeedback />} />
              <Route path="/student/results" element={<ViewResult />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
