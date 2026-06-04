import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/api';

const MAX_ATTEMPTS_FALLBACK = 3;

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

export default function GetFeedback() {
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [attempts, setAttempts] = useState(null);
  const [history, setHistory] = useState([]);
  const [latestFeedback, setLatestFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingFeedbackData, setLoadingFeedbackData] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.student.dashboard()
      .then((data) => setAssignments(data.assignments || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedAssignment = useMemo(
    () => assignments.find((assignment) => String(assignment.assignment_id) === String(selectedAssignmentId)) || null,
    [assignments, selectedAssignmentId]
  );

  const loadFeedbackData = async (assignmentId) => {
    if (!assignmentId) {
      setAttempts(null);
      setHistory([]);
      setLatestFeedback(null);
      return;
    }

    setLoadingFeedbackData(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.student.feedbackHistory(assignmentId);
      setAttempts(data.attempts || null);
      setHistory(data.history || []);
      setLatestFeedback((data.history || []).find((item) => item.feedback_status === 'completed') || null);
    } catch (err) {
      setError(err.message);
      setAttempts(null);
      setHistory([]);
      setLatestFeedback(null);
    } finally {
      setLoadingFeedbackData(false);
    }
  };

  const handleAssignmentChange = async (assignmentId) => {
    setSelectedAssignmentId(assignmentId);
    await loadFeedbackData(assignmentId);
  };

  const handleRequestFeedback = async () => {
    if (!selectedAssignmentId) {
      setError('Select an assignment first.');
      return;
    }

    setGenerating(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.student.requestFeedback(selectedAssignmentId);
      setAttempts(data.attempts || null);
      setHistory(data.history || []);

      if (data.feedback?.feedback_status === 'completed') {
        setLatestFeedback(data.feedback);
        setSuccess('AI feedback generated.');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setLatestFeedback((data.history || []).find((item) => item.feedback_status === 'completed') || null);
        setError(data.feedback?.feedback_error || 'AI feedback could not be generated.');
      }
    } catch (err) {
      setError(err.message);
      await loadFeedbackData(selectedAssignmentId);
    } finally {
      setGenerating(false);
    }
  };

  const maxAttempts = attempts?.max_attempts || MAX_ATTEMPTS_FALLBACK;
  const remainingAttempts = attempts?.remaining_attempts ?? maxAttempts;
  const canRequest = Boolean(
    selectedAssignmentId &&
    selectedAssignment?.portfolio_id &&
    !generating &&
    !loadingFeedbackData &&
    (attempts ? attempts.can_request : true)
  );
  const limitReached = attempts && !attempts.can_request;

  return (
    <>
      <h1 className="page-title">Get Feedback</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card">
        <div className="alert alert-warning">
          This is an AI-generated feedback report for learning and improvement purposes only. It is not the final grade. Final marks are decided by the lecturer/head of department after official evaluation.
        </div>
        <div className="alert alert-info">
          You can request AI feedback a maximum of {maxAttempts} times for this assignment.
        </div>

        <div className="form-row">
          <label className="form-label">Assignment:</label>
          <select
            className="form-select"
            value={selectedAssignmentId}
            onChange={(event) => handleAssignmentChange(event.target.value)}
            disabled={loading}
          >
            <option value="">Select Assignment</option>
            {assignments.map((assignment) => (
              <option key={assignment.assignment_id} value={assignment.assignment_id}>
                {assignment.assignment_name} ({assignment.course_name})
              </option>
            ))}
          </select>
        </div>

        {selectedAssignment && (
          <div className="feedback-summary">
            <div>
              <span className="feedback-summary-label">Submission Status</span>
              <strong>{selectedAssignment.status}</strong>
            </div>
            <div>
              <span className="feedback-summary-label">Uploaded</span>
              <strong>{selectedAssignment.upload_date ? formatDate(selectedAssignment.upload_date) : 'No submission yet'}</strong>
            </div>
            <div>
              <span className="feedback-summary-label">Feedback Attempts Remaining</span>
              <strong>{remainingAttempts}/{maxAttempts}</strong>
            </div>
          </div>
        )}

        {selectedAssignment && !selectedAssignment.portfolio_id && (
          <div className="alert alert-warning">
            Upload your assignment submission before requesting AI feedback.
          </div>
        )}

        {limitReached && (
          <div className="alert alert-warning">
            You have used all {maxAttempts} AI feedback attempts for this assignment.
          </div>
        )}

        <div className="action-row">
          <button
            className="btn btn-primary"
            onClick={handleRequestFeedback}
            disabled={!canRequest}
          >
            {generating ? 'Generating Feedback...' : 'Get AI Feedback'}
          </button>
        </div>

        {loadingFeedbackData && (
          <div className="spinner-wrap"><div className="spinner" /></div>
        )}

        {latestFeedback?.feedback_text && (
          <div className="feedback-report">
            <div className="section-header">Latest AI Feedback</div>
            <div className="section-content">
              <pre className="feedback-report-text">{latestFeedback.feedback_text}</pre>
            </div>
          </div>
        )}

        <div className="feedback-section">
          <div className="section-container">
            <div className="section-header">Previous Feedback History</div>
            <div className="section-content">
              {!selectedAssignmentId ? (
                <div className="feedback-empty">Select an assignment to view feedback history.</div>
              ) : history.length === 0 ? (
                <div className="feedback-empty">No feedback history for this assignment yet.</div>
              ) : (
                <div className="feedback-history-list">
                  {history.map((item) => (
                    <div key={item.feedback_id} className="feedback-history-item">
                      <div className="feedback-history-meta">
                        <strong>Attempt {item.attempt_no}</strong>
                        <span>{formatDate(item.created_at)}</span>
                        <span className={`badge ${item.feedback_status === 'completed' ? 'badge-success' : item.feedback_status === 'failed' ? 'badge-danger' : 'badge-info'}`}>
                          {item.feedback_status}
                        </span>
                      </div>
                      {item.feedback_status === 'completed' ? (
                        <pre className="feedback-report-text">{item.feedback_text}</pre>
                      ) : (
                        <div className="feedback-error-text">{item.feedback_error || 'Feedback could not be generated.'}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
