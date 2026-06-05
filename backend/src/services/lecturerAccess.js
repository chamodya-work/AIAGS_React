import { query } from '../db.js';

export function isAdmin(req) {
  return req.user?.role === 'admin';
}

export function isLecturer(req) {
  return req.user?.role === 'teacher';
}

export function lecturerPortfolioJoin(req, portfolioAlias = 'p') {
  if (!isLecturer(req)) return { join: '', params: [] };
  return {
    join: `JOIN lecturer_portfolio_assignments lpa_access
             ON lpa_access.portfolio_id = ${portfolioAlias}.portfolio_id
            AND lpa_access.lecturer_user_id = ?`,
    params: [req.user.user_id],
  };
}

export async function canAccessPortfolio(req, portfolioId) {
  if (isAdmin(req)) return true;
  if (!isLecturer(req)) return false;

  const row = (
    await query(
      `SELECT 1
       FROM lecturer_portfolio_assignments
       WHERE portfolio_id=? AND lecturer_user_id=?
       LIMIT 1`,
      [portfolioId, req.user.user_id]
    )
  )[0];

  return Boolean(row);
}

export async function portfolioExists(portfolioId) {
  const row = (
    await query('SELECT portfolio_id FROM portfolios WHERE portfolio_id=? LIMIT 1', [portfolioId])
  )[0];
  return Boolean(row);
}

export async function ensurePortfolioAccess(req, res, portfolioId) {
  if (!Number.isInteger(portfolioId) || portfolioId <= 0) {
    res.status(400).json({ error: 'Invalid portfolio id' });
    return false;
  }

  if (!(await portfolioExists(portfolioId))) {
    res.status(404).json({ error: 'Portfolio not found' });
    return false;
  }

  if (!(await canAccessPortfolio(req, portfolioId))) {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }

  return true;
}
