import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

const DEFAULT_REPORT_DIR = path.join('private', 'reports');

function reportRootDir() {
  return path.resolve(process.cwd(), process.env.AI_REPORT_DIR || DEFAULT_REPORT_DIR);
}

function storedPathFor(absolutePath) {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
}

function stripReportPreamble(reportText) {
  const text = String(reportText || '').replace(/\r/g, '');
  const marker = text.indexOf('1. Overall Evaluation');
  return marker >= 0 ? text.slice(marker).trim() : text.trim();
}

function writeMetaLine(doc, label, value) {
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`${label}: `, { continued: true })
    .font('Helvetica')
    .text(String(value || 'Not specified'));
}

function writeReportBody(doc, reportText) {
  const lines = stripReportPreamble(reportText).split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      doc.moveDown(0.35);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      doc
        .moveDown(0.6)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(trimmed);
      continue;
    }

    if (trimmed.startsWith('- ')) {
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .text(trimmed, { indent: 14, lineGap: 3 });
      continue;
    }

    doc
      .font('Helvetica')
      .fontSize(10.5)
      .text(trimmed, { lineGap: 3 });
  }
}

export function resolveReportPdfPath(storedPath) {
  if (!storedPath) return null;
  if (path.isAbsolute(storedPath)) return path.resolve(storedPath);
  return path.resolve(process.cwd(), storedPath.replace(/^\/+/, '').replace(/\//g, path.sep));
}

export function makeReportFilename(portfolioId) {
  return `ai-assignment-evaluation-report-${portfolioId}.pdf`;
}

export async function generateAiReportPdf({
  portfolioId,
  studentNo,
  assignmentName,
  courseName,
  generatedDate,
  aiScore,
  reportText,
}) {
  const dir = reportRootDir();
  fs.mkdirSync(dir, { recursive: true });

  const absolutePath = path.join(dir, makeReportFilename(portfolioId));

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(absolutePath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('AI Assignment Evaluation Report', { align: 'center' });

    doc.moveDown(1);
    writeMetaLine(doc, 'Student Number', studentNo);
    writeMetaLine(doc, 'Assignment', assignmentName);
    writeMetaLine(doc, 'Course', courseName);
    writeMetaLine(doc, 'Generated Date', generatedDate);
    // writeMetaLine(doc, 'AI Score', `${aiScore ?? '-'} / 100`);

    doc.moveDown(0.6);
    writeReportBody(doc, reportText);

    doc.moveDown(1);
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .text(
        'Disclaimer: This AI-generated report is for evaluation support only. Final grading decisions must be made by the lecturer/head of department.',
        { lineGap: 2 }
      );

    doc.end();
  });

  return {
    absolutePath,
    storedPath: storedPathFor(absolutePath),
  };
}
