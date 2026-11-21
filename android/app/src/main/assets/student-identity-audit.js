(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MushrifiStudentAudit = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  function normalizeNameKey(value) {
    return String(value ?? '').normalize('NFKC')
      .replace(/[ـ\u064B-\u065F\u0670\u200E\u200F\u200B-\u200D\uFEFF]/g, '')
      .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[أإآٱ]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim().split(/\s+/)
      .map(token => /[\p{L}][0-9]+$/u.test(token) ? token.replace(/[0-9]+$/g, '') : token)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ar'))
      .join(' ').toLocaleLowerCase('ar');
  }

  function normalizeSectionKey(value) {
    return String(value ?? '').normalize('NFKC')
      .replace(/[ـ\u064B-\u065F\u0670\u200E\u200F\u200B-\u200D\uFEFF]/g, '')
      .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[أإآٱ]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');
  }

  function isIdLike(value) {
    const text = String(value ?? '').trim();
    return /^student[_:-]/i.test(text) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text);
  }

  function studentNameKey(student) {
    const last = String(student?.last ?? student?.surname ?? '').trim();
    const first = String(student?.first ?? student?.firstname ?? '').trim();
    const raw = [last, first].filter(Boolean).join(' ') ||
      String(student?.name ?? student?.fullName ?? student?.studentName ?? '');
    return normalizeNameKey(raw);
  }

  function uniqueKeys(values, normalize) {
    return [...new Set(values.map(normalize).filter(Boolean))];
  }

  function studentSectionKeys(student) {
    const classValue = student?.class || student?.sectionNumber || student?.section ||
      student?.className || student?.classe || student?.group || '';
    const composite = [student?.schoolYear, student?.branch, classValue].filter(Boolean).join(' — ');
    return uniqueKeys([
      student?.sectionNumber, student?.class, student?.section, student?.className,
      student?.classe, student?.group, composite
    ], normalizeSectionKey);
  }

  function recordSectionKeys(record) {
    const classValue = record?.class || record?.studentClass || record?.section ||
      record?.sectionLabel || record?.className || record?.group || '';
    const composite = [record?.schoolYear, record?.branch, classValue].filter(Boolean).join(' — ');
    return uniqueKeys([
      record?.class, record?.studentClass, record?.section, record?.sectionLabel,
      record?.className, record?.group, composite
    ], normalizeSectionKey);
  }

  function sectionsMatch(student, record) {
    const recordKeys = recordSectionKeys(record);
    if (!recordKeys.length) return true;
    const studentKeys = new Set(studentSectionKeys(student));
    return recordKeys.some(key => studentKeys.has(key));
  }

  function resolveStudentForRecord(students, record) {
    const list = Array.isArray(students) ? students : [];
    const reference = String(record?.student ?? '').trim();
    const idMatches = reference ? list.filter(student => String(student?.id ?? '').trim() === reference) : [];
    if (idMatches.length === 1) return { student: idMatches[0], reason: 'id', candidates: idMatches };
    if (idMatches.length > 1) return { student: null, reason: 'ambiguous', candidates: idMatches };

    const nameValues = [];
    if (record?.studentName) nameValues.push(record.studentName);
    if (reference && !isIdLike(reference)) nameValues.push(reference);
    const nameKeys = new Set(nameValues.map(normalizeNameKey).filter(Boolean));
    if (!nameKeys.size) return { student: null, reason: 'none', candidates: [] };

    const candidates = list.filter(student =>
      nameKeys.has(studentNameKey(student)) && sectionsMatch(student, record)
    );
    if (candidates.length === 1) return { student: candidates[0], reason: 'name', candidates };
    if (candidates.length > 1) return { student: null, reason: 'ambiguous', candidates };
    return { student: null, reason: 'none', candidates: [] };
  }

  function studentSectionKey(student) {
    const classValue = student?.class || student?.sectionNumber || student?.section ||
      student?.className || student?.classe || student?.group || '';
    if (!String(classValue).trim()) return '';
    return [student?.schoolYear, student?.branch, classValue]
      .map(normalizeSectionKey).join('¦');
  }

  function recordSummary(kind, record, candidates) {
    const reference = String(record?.student ?? '').trim();
    const name = String(record?.studentName || (!isIdLike(reference) ? reference : '') || 'اسم غير محفوظ');
    const labels = { attendance: 'حضور/غياب/تأخر', documents: 'وثيقة', violations: 'مخالفة' };
    return {
      kind,
      kindLabel: labels[kind] || kind,
      id: String(record?.id ?? ''),
      date: String(record?.date ?? ''),
      type: String(record?.type ?? labels[kind] ?? kind),
      name,
      section: String(record?.sectionLabel || record?.class || record?.studentClass || record?.section || ''),
      notes: String(record?.notes || record?.reason || record?.description || ''),
      candidateIds: candidates.map(student => String(student?.id ?? '')),
      candidateNames: candidates.map(student =>
        ([student?.last, student?.first].filter(Boolean).join(' ').trim() ||
          student?.name || student?.fullName || 'اسم غير محدد') +
        ' [' + String(student?.id ?? 'بلا معرف') + ']'
      )
    };
  }

  function buildStudentNameAuditReport(db) {
    const students = Array.isArray(db?.students) ? db.students : [];
    const kinds = ['attendance', 'documents', 'violations'];
    const stableByStudent = new Map();
    const legacyByStudent = new Map();
    students.forEach(student => {
      stableByStudent.set(student, { attendance: [], documents: [], violations: [] });
      legacyByStudent.set(student, { attendance: [], documents: [], violations: [] });
    });

    const ambiguousRecords = [];
    const unmatchedRecords = [];
    const summary = { totalRecords: 0, stableLinked: 0, legacyUnique: 0, ambiguous: 0, unmatched: 0 };

    kinds.forEach(kind => {
      const records = Array.isArray(db?.[kind]) ? db[kind] : [];
      records.forEach(record => {
        summary.totalRecords++;
        const resolution = resolveStudentForRecord(students, record);
        const info = recordSummary(kind, record, resolution.candidates || []);
        if (resolution.reason === 'id' && resolution.student) {
          stableByStudent.get(resolution.student)[kind].push(info);
          summary.stableLinked++;
        } else if (resolution.reason === 'name' && resolution.student) {
          legacyByStudent.get(resolution.student)[kind].push(info);
          summary.legacyUnique++;
        } else if (resolution.reason === 'ambiguous') {
          ambiguousRecords.push(info);
          summary.ambiguous++;
        } else {
          unmatchedRecords.push(info);
          summary.unmatched++;
        }
      });
    });

    const groupsByKey = new Map();
    students.forEach(student => {
      const nameKey = studentNameKey(student);
      const sectionKey = studentSectionKey(student);
      if (!nameKey || !sectionKey) return;
      const key = sectionKey + '||' + nameKey;
      if (!groupsByKey.has(key)) {
        const classValue = student.class || student.sectionNumber || student.section ||
          student.className || student.classe || student.group || '';
        groupsByKey.set(key, {
          section: [student.schoolYear, student.branch, classValue].filter(Boolean).join(' / '),
          nameKey,
          students: []
        });
      }
      groupsByKey.get(key).students.push(student);
    });

    const groups = [...groupsByKey.values()].filter(group => group.students.length > 1).map(group => {
      const ids = new Set(group.students.map(student => String(student?.id ?? '')));
      return {
        section: group.section,
        nameKey: group.nameKey,
        members: group.students.map(student => ({
          id: String(student?.id ?? ''),
          name: ([student?.last, student?.first].filter(Boolean).join(' ').trim() ||
            student?.name || student?.fullName || 'اسم غير محدد'),
          stable: stableByStudent.get(student),
          legacy: legacyByStudent.get(student)
        })),
        ambiguousRecords: ambiguousRecords.filter(record =>
          record.candidateIds.some(id => ids.has(id))
        )
      };
    });

    summary.groups = groups.length;
    summary.duplicateCards = groups.reduce((total, group) => total + group.members.length, 0);
    return { summary, groups, ambiguousRecords, unmatchedRecords };
  }

  return {
    normalizeNameKey,
    normalizeSectionKey,
    isIdLike,
    resolveStudentForRecord,
    buildStudentNameAuditReport
  };
});
