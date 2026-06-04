export default function GetFeedback() {
  return (
    <>
      <h1 className="page-title">Get Feedback</h1>

      <div className="content-card">
        <div className="alert alert-warning">
          Student AI feedback is not enabled yet. This page will be connected to the separate student feedback workflow in the next implementation step.
        </div>
        <div style={{ fontSize:14, lineHeight:1.7, color:'#555' }}>
          Students will only receive improvement-focused feedback here. AI scores, rubric details, grading reports, and hidden marking logic will not be shown to students.
        </div>
      </div>
    </>
  );
}
