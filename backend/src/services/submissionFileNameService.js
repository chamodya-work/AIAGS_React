import path from 'path';

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function sanitizeFilenameSegment(value, fallback = 'file') {
  const cleaned = cleanText(value)
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function formatSubmissionDisplayName(studentNo, documentName, originalName, filePath = '') {
  const extension = path.extname(cleanText(originalName)) || path.extname(cleanText(filePath));
  const safeStudentNo = sanitizeFilenameSegment(studentNo, 'student');
  const safeDocumentName = sanitizeFilenameSegment(documentName, 'assignment_submission');
  return `${safeStudentNo}_${safeDocumentName}${extension}`;
}

export function submissionDisplayName(row = {}) {
  return formatSubmissionDisplayName(
    row.student_no,
    row.document_name || row.required_document_name,
    row.original_name,
    row.file_path
  );
}

export function safeContentDispositionFilename(filename) {
  return sanitizeFilenameSegment(filename, 'submission').replace(/"/g, '');
}

export function isAiSupportedSubmissionPath(value) {
  return /\.(pdf|docx)$/i.test(cleanText(value));
}

export function applySubmissionDisplayNames(rows = [], files = []) {
  const byPortfolio = new Map();
  for (const file of files) {
    const portfolioId = Number(file.portfolio_id);
    if (!Number.isInteger(portfolioId)) continue;
    const displayName = submissionDisplayName(file);
    const item = { ...file, display_name: displayName, original_name: displayName };
    if (!byPortfolio.has(portfolioId)) byPortfolio.set(portfolioId, []);
    byPortfolio.get(portfolioId).push(item);
  }

  return rows.map((row) => {
    const portfolioFiles = byPortfolio.get(Number(row.portfolio_id)) || [];
    const primaryFile = portfolioFiles.find((file) => Number(file.file_id) === Number(row.primary_file_id));
    const mainAnswerFiles = portfolioFiles.filter((file) => Boolean(file.is_ai_gradable));
    const aiSupportedMainAnswerFiles = mainAnswerFiles.filter((file) => (
      isAiSupportedSubmissionPath(file.file_path) || isAiSupportedSubmissionPath(file.original_name)
    ));

    return {
      ...row,
      primary_file_name: primaryFile?.display_name || row.primary_file_name,
      main_answer_uploaded_files: mainAnswerFiles.length
        ? mainAnswerFiles.map((file) => file.display_name).join(', ')
        : row.main_answer_uploaded_files,
      ai_grading_file_names: aiSupportedMainAnswerFiles.length
        ? aiSupportedMainAnswerFiles.map((file) => file.display_name).join(', ')
        : row.ai_grading_file_names,
    };
  });
}
