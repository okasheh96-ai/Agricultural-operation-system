// Arabic-first strings. Every visible string has an ar and an en entry.
import { useSyncExternalStore } from 'react';

type Dict = Record<string, string>;

const ar: Dict = {
  app_title: 'تشغيل بيت التعبئة', lang_switch: 'English', loading: 'جارٍ التحميل…', saving: 'جارٍ الحفظ…', saved: 'تم الحفظ', failed: 'تعذّر الإتمام', retry: 'إعادة المحاولة',
  empty: 'لا توجد بيانات بعد', unavailable: 'غير متاح', nyv: 'غير مؤكد بعد', cancel: 'إلغاء', save: 'حفظ', close: 'إغلاق', edit: 'تعديل', add: 'إضافة', remove: 'إزالة', yes: 'نعم', no: 'لا',
  search: 'بحث', load_more: 'عرض المزيد', of: 'من', rows: 'صفوف', confirm: 'تأكيد', reason: 'السبب', reason_required: 'اكتب السبب', back: 'رجوع', details: 'التفاصيل', all: 'الكل', none: 'لا شيء',
  nav_today: 'اليوم', nav_plan: 'الخطة', nav_import: 'استيراد', nav_review: 'مراجعة', nav_settings: 'الإعدادات',
  role_owner: 'المالك', role_viewer: 'مشاهدة فقط', sign_out: 'تسجيل الخروج',
  err_not_authenticated: 'لم يتم التحقق من هويتك. افتح الرابط من جديد وسجّل الدخول.', err_no_access: 'ليس لديك صلاحية على هذه اللوحة. اطلب من المالك منحك الصلاحية.',
  err_owner_only: 'هذا الإجراء للمالك فقط.', err_network: 'لا يوجد اتصال. تحقّق من الشبكة ثم أعد المحاولة.', err_generic: 'حدث خطأ',
  // guide
  guide_title: 'دليل الاستخدام السريع', guide_dismiss: 'فهمت، لا تعرض الدليل مجددًا',
  guide_1: '١. الإعدادات: أضف خطوط التعبئة والمنتجات والدرجات والوحدات، وأوزان الصناديق الموثّقة، وحدود التسامح. التطبيق لا يخترع أي تحويل.',
  guide_2: '٢. الخطة: أنشئ خطة الوردية (يدويًا أو من ملف Excel أو صورة أو بنسخ خطة سابقة)، احفظها كمسودة، ثم انشرها. النشر يجمّد النسخة الأصلية، وأي تعديل لاحق يُسجَّل بوقت سريان وسبب.',
  guide_3: '٣. الاستيراد: ارفع ملف Excel أو CSV أو صورة. اختر الورقة، وصنّف الأعمدة (خطة/فعلي/مرجعي)، واحفظ التصنيف لإعادة استخدامه.',
  guide_4: '٤. المراجعة: راجع الحقول الناقصة والقيم غير الواضحة والتكرارات والفروقات، صحّح ما يلزم مع ذكر السبب، ثم اعتمد. الأرقام المعتمدة فقط تظهر في النتائج.',
  guide_5: '٥. أثناء الوردية: زر «تحديث سريع» لتسجيل قراءة بوقتها. حدّد إن كانت إضافة لفترة أم مجموعًا تراكميًا.',
  guide_6: '٦. المشاهدون: من الإعدادات ← الصلاحيات امنح أو اسحب «مشاهدة اللوحة كاملة». ويمكنك مشاركة لقطة مجمّدة لها تاريخ انتهاء.',
  guide_7: '٧. النسخ الاحتياطي: يعمل تلقائيًا كل ليلة. من الإعدادات ← النسخ الاحتياطي ترى آخر نسخة ناجحة، وتنزّل نسخة كاملة، وتجرّب الاستعادة في قاعدة معزولة.',
  // dashboard
  dash_now: 'الآن', dash_last_reading: 'آخر قراءة معتمدة تغطي حتى', dash_no_reading: 'لا توجد قراءة معتمدة بعد', dash_date: 'تاريخ الوردية', dash_compare: 'المقارنة مع',
  compare_current: 'الخطة المعدّلة (الحالية)', compare_baseline: 'الخطة الأصلية', dash_range_from: 'من', dash_range_to: 'إلى', filter_line: 'الخط', filter_product: 'المنتج', filter_grade: 'الدرجة', filter_customer: 'العميل',
  clear_filters: 'مسح الفلاتر', filters: 'فلاتر إضافية', sec_today: 'تقدّم اليوم', sec_production: 'الإنتاج', sec_productivity: 'الإنتاجية', sec_waste: 'الهدر والدفعات', sec_downtime: 'التوقفات', sec_orders: 'الطلبيات', sec_sales: 'المبيعات', sec_data: 'بيانات أخرى', sec_summary: 'ملخص للإدارة',
  no_plan: 'لا توجد خطة منشورة لهذا التاريخ', no_plan_owner: 'لا توجد خطة منشورة. افتح «الخطة» لإنشائها.', current_job: 'الحالي', next_job: 'التالي', full_target: 'الهدف الكامل', due_now: 'المستحق حتى القراءة', approved_actual: 'الفعلي المعتمد',
  variance: 'الفرق', pct_full: '٪ من الهدف الكامل', pct_due: '٪ من المستحق', remaining: 'المتبقي', pace_needed: 'المعدل المطلوب', per_hour: '/ساعة', awaiting_update: 'بانتظار تحديث',
  st_scheduled: 'مجدول', st_awaiting: 'بانتظار تحديث', st_on_track: 'ضمن الخطة', st_ahead: 'متقدم', st_behind: 'متأخر', st_complete: 'مكتمل', st_no_schedule: 'لا جدول زمني', st_unavailable: 'غير متاح',
  packed_by_grade: 'المعبّأ (كغ) حسب الدرجة', kg: 'كغ', worker_hours: 'ساعات العمل', planned: 'المخطط', actual: 'الفعلي', kg_per_wh: 'كغ/ساعة عامل', capacity: 'الطاقة', inconsistent_target: 'الهدف غير متّسق مع المعدل × ساعات العمل',
  rate_entered: 'معدل مُدخل', rate_derived: 'معدل محسوب', overlap_hours: 'ساعات متداخلة احتُسبت مرة واحدة', missing_conversion: 'لا يوجد تحويل موثّق لهذه الوحدة',
  lot: 'الدفعة', input: 'المدخل', packed: 'المعبّأ', waste: 'الهدر', carry_out: 'مُرحّل', gap: 'الفجوة', waste_pct: 'نسبة الهدر', lot_open: 'مفتوحة', lot_closed: 'مغلقة', lot_flag: 'فجوة تتجاوز التسامح', waste_vs_input: 'الهدر مقابل مدخلات الدفعات المطابقة',
  downtime_min: 'دقائق التوقف', by_line_reason: 'حسب الخط والسبب', order: 'الطلبية', dispatched: 'المشحون', produced: 'المُنتج',
  basis_orders: 'طلبيات مؤكدة', basis_dispatch: 'شحنات', basis_invoiced: 'مبيعات مفوترة صافية', period_day: 'يوم', period_week: 'أسبوع', period_month: 'شهر', period_elapsed: 'من الفترة انقضى',
  gross: 'الفواتير', credits: 'الإشعارات الدائنة', net: 'الصافي', shortfall: 'العجز عن المستحق', wait_schedule: 'لا يوجد جدول مراحل؛ لا يُحكم بالتأخر',
  unconfirmed_rule: 'طريقة التجميع لم تُؤكَّد بعد', confirm_rule: 'تأكيد طريقة التجميع', agg_sum: 'جمع', agg_latest: 'آخر قيمة', agg_avg: 'متوسط',
  kind_quantity: 'كمية', kind_count: 'عدد', kind_rate: 'معدل', kind_price: 'سعر', kind_balance: 'رصيد', kind_duration: 'مدة',
  drill: 'السجلات المعتمدة', previous_period: 'الفترة السابقة', live: 'مباشر', updated: 'تم التحديث', present: 'عرض كامل', print_pdf: 'طباعة / PDF', make_snapshot: 'لقطة مجمّدة',
  sum_line_behind: 'الخط {line}: {actual} من {due} {unit} مستحقة (فرق {variance}).', sum_line_ahead: 'الخط {line}: متقدم، {actual} مقابل {due} {unit} مستحقة.', sum_line_on_track: 'الخط {line}: ضمن الخطة، {actual} من {due} {unit}.',
  sum_line_complete: 'الخط {line}: أكمل الهدف.', sum_line_awaiting: 'الخط {line}: بانتظار تحديث.', sum_productivity: 'الإنتاجية {rate} كغ/ساعة عامل مقابل {planned} مخطط.', sum_lot_gap: 'الدفعة {lot}: فجوة {gap} كغ تحتاج تفسيرًا.',
  sum_waste: 'الهدر {pct} ({kg} كغ) من مدخلات الدفعات المطابقة.', sum_sales: 'مبيعات ({basis}): {actual} من {target} {unit}.', evidence: 'الدليل',
  quick_update: 'تحديث سريع', quick_title: 'تسجيل قراءة أثناء الوردية', reading_time: 'وقت القراءة', mode_interval: 'إضافة لفترة', mode_cumulative: 'مجموع تراكمي حتى الآن', qty: 'الكمية', unit: 'الوحدة', save_approve: 'حفظ واعتماد', staged_only: 'حفظ للمراجعة',
  // plan
  plan_title: 'خطة الوردية', plan_versions: 'النسخ', v_draft: 'مسودة', v_published: 'منشورة', v_discarded: 'ملغاة', v_baseline: 'الأصلية', v_revision: 'تعديل', new_draft: 'مسودة جديدة', from_empty: 'خطة فارغة', from_previous: 'نسخ خطة يوم سابق', revise_current: 'تعديل الخطة المنشورة',
  source_date: 'تاريخ المصدر', shift_start: 'بداية الوردية', jobs: 'المهام', add_job: 'إضافة مهمة', job_line: 'الخط', job_product: 'المنتج', job_grade: 'الدرجة / SKU', job_customer: 'العميل', job_order: 'رقم الطلبية', start: 'البداية', end: 'النهاية', target: 'الهدف',
  crew: 'عدد العمال', breaks: 'الاستراحات والتبديل', add_break: 'إضافة استراحة', kind_break: 'استراحة', kind_changeover: 'تبديل', crew_changes: 'تغيير عدد العمال', add_crew_change: 'إضافة تغيير', at_time: 'عند', rate_target: 'هدف كغ/ساعة عامل (اختياري)',
  milestones: 'مراحل مستحقة (اختياري)', add_milestone: 'إضافة مرحلة', cumulative: 'تراكمي', planned_wh: 'ساعات العمل المخططة', derived_rate: 'المعدل المحسوب', sales_targets: 'أهداف المبيعات', add_sales: 'إضافة هدف مبيعات',
  period: 'الفترة', period_start: 'بداية الفترة', basis: 'الأساس', measure: 'المقياس', m_qty: 'كمية', m_value: 'قيمة', price: 'السعر (معلومة)', due_date: 'تاريخ الاستحقاق', save_draft: 'حفظ المسودة', publish: 'نشر', publish_revision: 'نشر التعديل',
  effective_at: 'وقت سريان التعديل', discard: 'إلغاء المسودة', published_frozen: 'النسخة المنشورة مجمّدة ولا يمكن تعديلها.', compare_versions: 'مقارنة النسخ', plan_issues: 'ملاحظات على الخطة', next_day: '(اليوم التالي)', delete_job: 'حذف المهمة من المسودة',
  // import
  import_title: 'استيراد ملف أو صورة', choose_file: 'اختر ملف Excel أو CSV أو صورة', file_types: 'XLSX، CSV، JPG، PNG، HEIC', inspecting: 'جارٍ فحص الملف…', sheets: 'الأوراق', sheet_rows: 'صف', header_row: 'صف العناوين', first_data_row: 'أول صف بيانات',
  subtotal_rows: 'صفوف مجاميع مستبعدة', blank_rows: 'صفوف فارغة', merged: 'خلايا مدمجة', preview: 'معاينة', columns: 'الأعمدة', col_role: 'التصنيف', role_actual: 'فعلي', role_plan: 'خطة', role_reference: 'مرجعي', role_ignore: 'تجاهل',
  col_field: 'الحقل', col_metric: 'اسم المقياس', col_unit: 'الوحدة', col_dataset: 'نوع البيانات', dataset: 'نوع البيانات', ds_production: 'إنتاج معبّأ', ds_labour: 'عمالة / ساعات', ds_receiving: 'استلام', ds_waste: 'هدر', ds_carryover: 'ترحيل',
  ds_downtime: 'توقفات', ds_order: 'طلبيات', ds_dispatch: 'شحن', ds_invoice: 'فواتير', ds_credit: 'إشعارات دائنة', ds_plan: 'خطة', ds_mixed: 'تقرير دفعات (أنواع متعددة)', ds_custom: 'بيانات جديدة', custom_key: 'اسم البيانات الجديدة (لاتيني)',
  f_line: 'الخط', f_product: 'المنتج', f_grade: 'الدرجة', f_lot: 'الدفعة', f_customer: 'العميل', f_order_ref: 'رقم الطلبية', f_worker: 'العامل', f_reason: 'السبب', f_doc_no: 'رقم المستند', f_ref_doc_no: 'المستند المرجعي', f_status: 'الحالة', f_direction: 'اتجاه الترحيل (in/out)',
  f_date: 'التاريخ', f_time: 'الوقت', f_start_time: 'وقت البداية', f_end_time: 'وقت النهاية', f_unit: 'عمود الوحدة', f_measure: 'قيمة رقمية', shift_date: 'تاريخ الوردية', default_time: 'الوقت الذي يغطيه التقرير', reading_mode: 'نوع القراءة',
  mapping_name: 'اسم التصنيف', save_mapping: 'حفظ التصنيف لإعادة الاستخدام', use_mapping: 'تصنيف محفوظ', mapping_matched: 'تم تطبيق تصنيف محفوظ يطابق العناوين', stage_import: 'إرسال للمراجعة', uploading: 'جارٍ الرفع', sending_rows: 'جارٍ إرسال الصفوف',
  interrupted: 'استيرادات غير مكتملة', resume: 'استئناف', resume_pick: 'اختر الملف نفسه للاستئناف', resume_wrong_file: 'هذا ليس الملف نفسه (البصمة مختلفة).', duplicate_file_warn: 'هذا الملف رُفع سابقًا', renamed_dup: 'بالاسم', supersedes: 'يحلّ محل دفعة معتمدة',
  ocr_running: 'جارٍ قراءة الصورة على الجهاز…', ocr_lang: 'لغة الصورة', ocr_done: 'تمت القراءة. القيم منخفضة الثقة مُعلَّمة ويجب تأكيدها.', ocr_failed: 'تعذّرت قراءة الصورة', photo_evidence: 'إرفاق كدليل فقط', ai_second_pass: 'قراءة ثانية بالذكاء الاصطناعي (مدفوعة)',
  ai_off: 'القراءة الثانية متوقفة (من الإعدادات)', heic_converting: 'جارٍ تحويل صورة HEIC…', unsupported: 'نوع ملف غير مدعوم', value_cell: 'الخلية', mapping_needed: 'صنّف عمودًا واحدًا على الأقل كقيمة فعلية أو خطة',
  // review
  review_title: 'المراجعة والاعتماد', queue: 'بانتظار المراجعة', recent: 'آخر الدفعات', b_receiving: 'قيد الرفع', b_staged: 'بانتظار الاعتماد', b_approved: 'معتمدة', b_rejected: 'مرفوضة', b_superseded: 'مُستبدلة',
  issues: 'ملاحظات', blocking: 'تمنع الاعتماد', needs_review: 'تحتاج تأكيدًا', warnings: 'تنبيهات', expected: 'المتوقع', reported: 'المُبلَّغ', difference: 'الفرق', source: 'المصدر', exclude: 'استبعاد الصف', include: 'إعادة الصف', excluded: 'مستبعد',
  res_supersede: 'استبدال السجل المعتمد', res_keep_both: 'الاحتفاظ بالاثنين', approve: 'اعتماد', approve_ack: 'أؤكد أنني راجعت الفروقات وأعتمد', reject: 'رفض الدفعة', approved_ok: 'تم الاعتماد', facts_published: 'سجلات نُشرت', edit_history: 'سجل التعديلات', compare_prev: 'مقارنة مع النسخة السابقة',
  added: 'جديد', removed_rows: 'محذوف', changed: 'متغيّر', same: 'مطابق', set_supersede: 'هذه نسخة مصححة من دفعة معتمدة', choose_batch: 'اختر الدفعة', to_plan: 'إضافة إلى مسودة الخطة', open_original: 'فتح الأصل', confirm_value: 'تأكيد القيمة',
  i_missing_field: 'حقل ناقص', i_unreadable_number: 'رقم غير مقروء', i_ambiguous_number: 'فاصل عشري غامض', i_ambiguous_date: 'تاريخ غامض (يوم/شهر)', i_unreadable_date: 'تاريخ غير مقروء', i_unreadable_time: 'وقت غير مقروء', i_missing_unit: 'الوحدة ناقصة',
  i_unknown_unit: 'وحدة غير معرّفة في الإعدادات', i_unknown_code: 'رمز غير معرّف في الإعدادات', i_uncertain_ocr: 'قراءة غير مؤكدة', i_unreadable_value: 'قيمة غير مقروءة (تُركت فارغة)', i_negative: 'قيمة سالبة', i_rounded: 'قُرّبت لثلاث خانات',
  i_duplicate_in_batch: 'مكرر داخل الدفعة', i_already_approved: 'معتمد مسبقًا (تكرار)', i_conflicts_with_approved: 'يتعارض مع سجل معتمد', i_duplicate_file: 'الملف نفسه اعتُمد سابقًا', i_duplicate_content: 'المحتوى نفسه اعتُمد سابقًا (ربما باسم آخر)',
  i_incomplete_upload: 'الرفع غير مكتمل', i_lot_gap: 'فجوة في توازن الدفعة', i_lot_conversion_missing: 'تحويل وحدة ناقص لتوازن الدفعة', i_no_measure: 'لا توجد قيمة', i_bad_direction: 'اتجاه غير صحيح', i_bad_status: 'حالة غير صحيحة', i_measure_dataset_missing: 'حدد نوع البيانات لكل قيمة',
  // settings
  settings_title: 'الإعدادات', tab_ref: 'البيانات المرجعية', tab_conv: 'التحويلات', tab_general: 'عام والتسامح', tab_rules: 'المقاييس', tab_lots: 'الدفعات', tab_mappings: 'تصنيفات الاستيراد', tab_access: 'الصلاحيات', tab_snapshots: 'اللقطات', tab_backup: 'النسخ الاحتياطي والتصدير', tab_audit: 'سجل التدقيق',
  k_product: 'المنتجات', k_grade: 'الدرجات', k_line: 'الخطوط', k_unit: 'الوحدات', k_customer: 'العملاء', k_downtime_reason: 'أسباب التوقف', k_currency: 'العملات', code: 'الرمز', name_ar: 'الاسم بالعربية', name_en: 'الاسم بالإنجليزية', active: 'فعّال', inactive: 'موقوف', deactivate: 'إيقاف', activate: 'تفعيل',
  conv_from: 'من وحدة', conv_to: 'إلى وحدة', conv_factor: 'المعامل (كم من الوحدة الثانية في واحدة من الأولى)', conv_note: 'المصدر الموثّق (إلزامي)', conv_any: 'كل المنتجات',
  timezone: 'المنطقة الزمنية', lot_tol_abs: 'تسامح فجوة الدفعة (كغ)', lot_tol_pct: 'تسامح فجوة الدفعة (٪)', pace_tol: 'تسامح الحكم على التقدم (٪)', rate_tol: 'تسامح اتساق المعدل (٪)', ocr_threshold: 'حد الثقة لقراءة الصور (٪)', default_shift_start: 'بداية الوردية الافتراضية',
  ai_enabled: 'تفعيل القراءة الثانية بـ Workers AI', ai_limit: 'الحد الشهري لعدد القراءات', ai_note: 'متوقفة افتراضيًا. كل قراءة تُحتسب على حسابك في Cloudflare حسب تسعير Workers AI. عند بلوغ الحد تتوقف تلقائيًا.', show_workers_all: 'إظهار أسماء العمال لكل المشاهدين',
  tol_note: 'القيمة صفر تعني عدم التسامح: أي فرق يُعلَّم. اضبطها حسب سياستك.', rule_dataset: 'البيانات', rule_metric: 'المقياس', rule_kind: 'النوع', rule_agg: 'التجميع', close_lot: 'إغلاق الدفعة', reopen_lot: 'إعادة فتح', lot_note: 'ملاحظة',
  access_owner: 'المالك (من إعدادات النشر)', grant: 'منح «مشاهدة اللوحة كاملة»', email: 'البريد الإلكتروني', display_name: 'الاسم', show_workers: 'إظهار أسماء العمال له', revoke: 'سحب الصلاحية', revoked: 'مسحوبة', granted: 'ممنوحة منذ',
  access_note: 'المشاهد يسجّل الدخول ببريده عبر Cloudflare Access ويرى اللوحة كاملة ويغيّر فلاتره فقط. لا يستطيع الرفع أو التعديل أو الاعتماد، ولا يرى الملفات الأصلية أو ملاحظات المراجعة.',
  snap_title: 'عنوان اللقطة', snap_sections: 'الأقسام', snap_expires: 'تنتهي في', snap_recipients: 'المستلمون (بريد، اختياري)', snap_create: 'إنشاء لقطة', snap_link: 'رابط اللقطة', snap_copy: 'نسخ الرابط', snap_revoke: 'سحب اللقطة', snap_expired: 'منتهية', snap_revoked: 'مسحوبة', snap_active: 'فعّالة',
  snap_note: 'اللقطة مجمّدة: لا تتغير عند اعتماد بيانات جديدة. لا تمنح صاحبها وصولًا مباشرًا للوحة.', snap_frozen_at: 'جُمّدت في', snap_gone: 'هذه اللقطة لم تعد متاحة', snap_workers: 'تضمين أسماء العمال',
  backup_last: 'آخر نسخة احتياطية ناجحة', backup_never: 'لم تنجح أي نسخة بعد', backup_run: 'نسخ احتياطي الآن', backup_auto: 'تلقائي كل ليلة الساعة ٠٢:١٧ بتوقيت عمّان', rehearse: 'تجربة الاستعادة في قاعدة معزولة', rehearse_passed: 'نجحت الاستعادة: السجلات وبصمات الملفات مطابقة', rehearse_failed: 'فشلت تجربة الاستعادة',
  export_data: 'تنزيل نسخة كاملة (بيانات)', export_all: 'تنزيل نسخة كاملة مع الملفات الأصلية', recovery_title: 'مسار الاستعادة', recovery_1: '١. جرّب الاستعادة في القاعدة المعزولة أولًا وتأكد من مطابقة الأعداد والبصمات.', recovery_2: '٢. لاستعادة قاعدة الإنتاج لنقطة زمنية (حتى ٣٠ يومًا) استخدم D1 Time Travel من لوحة Cloudflare أو بالخطوات المكتوبة في دليل الاستعادة.',
  recovery_3: '٣. الملفات الأصلية محفوظة في حاوية النسخ الاحتياطي باسم بصمتها (SHA-256)، فلا تضيع حتى لو حُذفت من الحاوية الأصلية.', tables: 'الجداول', files: 'الملفات', status: 'الحالة', started: 'بدأت', finished: 'انتهت', run_ok: 'ناجحة', run_failed: 'فشلت', run_running: 'جارية',
  audit_actor: 'المستخدم', audit_action: 'الإجراء', audit_entity: 'العنصر', audit_at: 'الوقت', older: 'أقدم',
  snapshot_banner: 'لقطة مجمّدة — لا تتحدث تلقائيًا',
};

const en: Dict = {
  app_title: 'Packing House Ops', lang_switch: 'العربية', loading: 'Loading…', saving: 'Saving…', saved: 'Saved', failed: 'Failed', retry: 'Retry',
  empty: 'No data yet', unavailable: 'Unavailable', nyv: 'Not Yet Verified', cancel: 'Cancel', save: 'Save', close: 'Close', edit: 'Edit', add: 'Add', remove: 'Remove', yes: 'Yes', no: 'No',
  search: 'Search', load_more: 'Load more', of: 'of', rows: 'rows', confirm: 'Confirm', reason: 'Reason', reason_required: 'Enter a reason', back: 'Back', details: 'Details', all: 'All', none: 'None',
  nav_today: 'Today', nav_plan: 'Plan', nav_import: 'Import', nav_review: 'Review', nav_settings: 'Settings',
  role_owner: 'Owner', role_viewer: 'Read-only', sign_out: 'Sign out',
  err_not_authenticated: 'Your identity was not verified. Reopen the link and sign in.', err_no_access: 'You do not have access to this dashboard. Ask the owner to grant it.',
  err_owner_only: 'Only the owner can do this.', err_network: 'No connection. Check the network and retry.', err_generic: 'Something went wrong',
  guide_title: 'Quick guide', guide_dismiss: 'Got it, do not show again',
  guide_1: '1. Settings: add lines, products, grades, units, documented box weights and tolerances. The app never invents a conversion.',
  guide_2: '2. Plan: build the shift plan (by hand, from Excel or a photo, or by copying a previous one), save a draft, then publish. Publishing freezes the baseline; later revisions record an effective time and reason.',
  guide_3: '3. Import: upload Excel, CSV or a photo. Pick the sheet, classify columns (plan/actual/reference) and save the mapping for next time.',
  guide_4: '4. Review: check missing fields, unclear values, duplicates and discrepancies, correct with a reason, then approve. Only approved figures reach results.',
  guide_5: '5. During the shift: use “Quick update” to record a timestamped reading — an interval addition or a cumulative total.',
  guide_6: '6. Viewers: Settings → Access grants or revokes “View entire live dashboard”. You can also share a frozen snapshot with an expiry.',
  guide_7: '7. Backups run every night. Settings → Backups shows the last success, downloads a full export and rehearses a restore into an isolated database.',
  dash_now: 'Now', dash_last_reading: 'Last approved reading covers up to', dash_no_reading: 'No approved reading yet', dash_date: 'Shift date', dash_compare: 'Compare with',
  compare_current: 'Revised (current) plan', compare_baseline: 'Original plan', dash_range_from: 'From', dash_range_to: 'To', filter_line: 'Line', filter_product: 'Product', filter_grade: 'Grade', filter_customer: 'Customer',
  clear_filters: 'Clear filters', filters: 'More filters', sec_today: "Today's progress", sec_production: 'Production', sec_productivity: 'Productivity', sec_waste: 'Waste & lots', sec_downtime: 'Downtime', sec_orders: 'Orders', sec_sales: 'Sales', sec_data: 'Other data', sec_summary: 'Management summary',
  no_plan: 'No published plan for this date', no_plan_owner: 'No published plan. Open “Plan” to create one.', current_job: 'Current', next_job: 'Next', full_target: 'Full target', due_now: 'Due by reading', approved_actual: 'Approved actual',
  variance: 'Variance', pct_full: '% of full target', pct_due: '% of target due', remaining: 'Remaining', pace_needed: 'Pace needed', per_hour: '/h', awaiting_update: 'Awaiting update',
  st_scheduled: 'Scheduled', st_awaiting: 'Awaiting update', st_on_track: 'On track', st_ahead: 'Ahead', st_behind: 'Behind', st_complete: 'Complete', st_no_schedule: 'No schedule', st_unavailable: 'Unavailable',
  packed_by_grade: 'Packed kg by grade', kg: 'kg', worker_hours: 'Worker-hours', planned: 'Planned', actual: 'Actual', kg_per_wh: 'kg/worker-hour', capacity: 'Capacity', inconsistent_target: 'Target is inconsistent with rate × worker-hours',
  rate_entered: 'entered rate', rate_derived: 'derived rate', overlap_hours: 'overlapping hours counted once', missing_conversion: 'No documented conversion for this unit',
  lot: 'Lot', input: 'Input', packed: 'Packed', waste: 'Waste', carry_out: 'Carried over', gap: 'Gap', waste_pct: 'Waste %', lot_open: 'Open', lot_closed: 'Closed', lot_flag: 'Gap beyond tolerance', waste_vs_input: 'Waste against matched lot input',
  downtime_min: 'Downtime minutes', by_line_reason: 'by line and reason', order: 'Order', dispatched: 'Dispatched', produced: 'Produced',
  basis_orders: 'Confirmed orders', basis_dispatch: 'Dispatches', basis_invoiced: 'Net invoiced sales', period_day: 'Day', period_week: 'Week', period_month: 'Month', period_elapsed: 'of period elapsed',
  gross: 'Invoices', credits: 'Credits', net: 'Net', shortfall: 'Shortfall vs due', wait_schedule: 'No milestone schedule; lateness is not judged',
  unconfirmed_rule: 'Aggregation not confirmed yet', confirm_rule: 'Confirm aggregation', agg_sum: 'Sum', agg_latest: 'Latest value', agg_avg: 'Average',
  kind_quantity: 'Quantity', kind_count: 'Count', kind_rate: 'Rate', kind_price: 'Price', kind_balance: 'Balance', kind_duration: 'Duration',
  drill: 'Approved records', previous_period: 'Previous period', live: 'Live', updated: 'Updated', present: 'Present', print_pdf: 'Print / PDF', make_snapshot: 'Frozen snapshot',
  sum_line_behind: 'Line {line}: {actual} of {due} {unit} due (variance {variance}).', sum_line_ahead: 'Line {line}: ahead, {actual} vs {due} {unit} due.', sum_line_on_track: 'Line {line}: on track, {actual} of {due} {unit}.',
  sum_line_complete: 'Line {line}: target complete.', sum_line_awaiting: 'Line {line}: awaiting update.', sum_productivity: 'Productivity {rate} kg/worker-hour vs {planned} planned.', sum_lot_gap: 'Lot {lot}: {gap} kg gap needs an explanation.',
  sum_waste: 'Waste {pct} ({kg} kg) of matched lot input.', sum_sales: 'Sales ({basis}): {actual} of {target} {unit}.', evidence: 'Evidence',
  quick_update: 'Quick update', quick_title: 'Record a reading during the shift', reading_time: 'Reading time', mode_interval: 'Interval addition', mode_cumulative: 'Cumulative total so far', qty: 'Quantity', unit: 'Unit', save_approve: 'Save & approve', staged_only: 'Save for review',
  plan_title: 'Shift plan', plan_versions: 'Versions', v_draft: 'Draft', v_published: 'Published', v_discarded: 'Discarded', v_baseline: 'Baseline', v_revision: 'Revision', new_draft: 'New draft', from_empty: 'Empty plan', from_previous: 'Copy a previous day', revise_current: 'Revise the published plan',
  source_date: 'Source date', shift_start: 'Shift start', jobs: 'Jobs', add_job: 'Add job', job_line: 'Line', job_product: 'Product', job_grade: 'Grade / SKU', job_customer: 'Customer', job_order: 'Order no.', start: 'Start', end: 'Finish', target: 'Target',
  crew: 'Crew size', breaks: 'Breaks & changeovers', add_break: 'Add break', kind_break: 'Break', kind_changeover: 'Changeover', crew_changes: 'Crew changes', add_crew_change: 'Add change', at_time: 'At', rate_target: 'Target kg/worker-hour (optional)',
  milestones: 'Due milestones (optional)', add_milestone: 'Add milestone', cumulative: 'Cumulative', planned_wh: 'Planned worker-hours', derived_rate: 'Derived rate', sales_targets: 'Sales targets', add_sales: 'Add sales target',
  period: 'Period', period_start: 'Period start', basis: 'Basis', measure: 'Measure', m_qty: 'Quantity', m_value: 'Value', price: 'Price (informational)', due_date: 'Due date', save_draft: 'Save draft', publish: 'Publish', publish_revision: 'Publish revision',
  effective_at: 'Revision effective at', discard: 'Discard draft', published_frozen: 'A published version is frozen and cannot be edited.', compare_versions: 'Compare versions', plan_issues: 'Plan notes', next_day: '(next day)', delete_job: 'Remove job from draft',
  import_title: 'Import a file or photo', choose_file: 'Choose an Excel, CSV or photo file', file_types: 'XLSX, CSV, JPG, PNG, HEIC', inspecting: 'Inspecting file…', sheets: 'Sheets', sheet_rows: 'rows', header_row: 'Header row', first_data_row: 'First data row',
  subtotal_rows: 'subtotal rows excluded', blank_rows: 'blank rows', merged: 'merged cells', preview: 'Preview', columns: 'Columns', col_role: 'Class', role_actual: 'Actual', role_plan: 'Plan', role_reference: 'Reference', role_ignore: 'Ignore',
  col_field: 'Field', col_metric: 'Measure name', col_unit: 'Unit', col_dataset: 'Dataset', dataset: 'Dataset', ds_production: 'Packed production', ds_labour: 'Labour / hours', ds_receiving: 'Receiving', ds_waste: 'Waste', ds_carryover: 'Carryover',
  ds_downtime: 'Downtime', ds_order: 'Orders', ds_dispatch: 'Dispatch', ds_invoice: 'Invoices', ds_credit: 'Credit notes', ds_plan: 'Plan', ds_mixed: 'Lot report (several datasets)', ds_custom: 'New dataset', custom_key: 'New dataset key (latin)',
  f_line: 'Line', f_product: 'Product', f_grade: 'Grade', f_lot: 'Lot', f_customer: 'Customer', f_order_ref: 'Order no.', f_worker: 'Worker', f_reason: 'Reason', f_doc_no: 'Document no.', f_ref_doc_no: 'Referenced document', f_status: 'Status', f_direction: 'Carryover direction (in/out)',
  f_date: 'Date', f_time: 'Time', f_start_time: 'Start time', f_end_time: 'End time', f_unit: 'Unit column', f_measure: 'Numeric value', shift_date: 'Shift date', default_time: 'Time covered by this report', reading_mode: 'Reading type',
  mapping_name: 'Mapping name', save_mapping: 'Save mapping for reuse', use_mapping: 'Saved mapping', mapping_matched: 'Applied a saved mapping that matches these headers', stage_import: 'Send to review', uploading: 'Uploading', sending_rows: 'Sending rows',
  interrupted: 'Interrupted imports', resume: 'Resume', resume_pick: 'Pick the same file to resume', resume_wrong_file: 'This is not the same file (checksum differs).', duplicate_file_warn: 'This file was uploaded before', renamed_dup: 'as', supersedes: 'Supersedes an approved batch',
  ocr_running: 'Reading the photo on this device…', ocr_lang: 'Photo language', ocr_done: 'Read. Low-confidence values are flagged and must be confirmed.', ocr_failed: 'Could not read the photo', photo_evidence: 'Attach as evidence only', ai_second_pass: 'AI second pass (paid)',
  ai_off: 'AI second pass is off (Settings)', heic_converting: 'Converting HEIC photo…', unsupported: 'Unsupported file type', value_cell: 'Cell', mapping_needed: 'Classify at least one column as an actual or plan value',
  review_title: 'Review & approve', queue: 'Waiting for review', recent: 'Recent batches', b_receiving: 'Uploading', b_staged: 'Awaiting approval', b_approved: 'Approved', b_rejected: 'Rejected', b_superseded: 'Superseded',
  issues: 'Issues', blocking: 'block approval', needs_review: 'need confirmation', warnings: 'warnings', expected: 'Expected', reported: 'Reported', difference: 'Difference', source: 'Source', exclude: 'Exclude row', include: 'Include row', excluded: 'Excluded',
  res_supersede: 'Supersede the approved record', res_keep_both: 'Keep both', approve: 'Approve', approve_ack: 'I reviewed the discrepancies and approve', reject: 'Reject batch', approved_ok: 'Approved', facts_published: 'records published', edit_history: 'Edit history', compare_prev: 'Compare with previous version',
  added: 'Added', removed_rows: 'Removed', changed: 'Changed', same: 'Unchanged', set_supersede: 'This is a corrected version of an approved batch', choose_batch: 'Choose batch', to_plan: 'Add to plan draft', open_original: 'Open original', confirm_value: 'Confirm value',
  i_missing_field: 'Missing field', i_unreadable_number: 'Unreadable number', i_ambiguous_number: 'Ambiguous decimal separator', i_ambiguous_date: 'Ambiguous date (day/month)', i_unreadable_date: 'Unreadable date', i_unreadable_time: 'Unreadable time', i_missing_unit: 'Missing unit',
  i_unknown_unit: 'Unit not defined in Settings', i_unknown_code: 'Code not defined in Settings', i_uncertain_ocr: 'Uncertain reading', i_unreadable_value: 'Unreadable value (left blank)', i_negative: 'Negative value', i_rounded: 'Rounded to 3 decimals',
  i_duplicate_in_batch: 'Duplicate within batch', i_already_approved: 'Already approved (duplicate)', i_conflicts_with_approved: 'Conflicts with an approved record', i_duplicate_file: 'Same file already approved', i_duplicate_content: 'Same content already approved (possibly renamed)',
  i_incomplete_upload: 'Upload incomplete', i_lot_gap: 'Lot balance gap', i_lot_conversion_missing: 'Missing unit conversion for lot balance', i_no_measure: 'No value', i_bad_direction: 'Invalid direction', i_bad_status: 'Invalid status', i_measure_dataset_missing: 'Set a dataset for each value',
  settings_title: 'Settings', tab_ref: 'Reference data', tab_conv: 'Conversions', tab_general: 'General & tolerances', tab_rules: 'Measures', tab_lots: 'Lots', tab_mappings: 'Import mappings', tab_access: 'Access', tab_snapshots: 'Snapshots', tab_backup: 'Backups & export', tab_audit: 'Audit log',
  k_product: 'Products', k_grade: 'Grades', k_line: 'Lines', k_unit: 'Units', k_customer: 'Customers', k_downtime_reason: 'Downtime reasons', k_currency: 'Currencies', code: 'Code', name_ar: 'Arabic name', name_en: 'English name', active: 'Active', inactive: 'Inactive', deactivate: 'Deactivate', activate: 'Activate',
  conv_from: 'From unit', conv_to: 'To unit', conv_factor: 'Factor (how many of the second unit in one of the first)', conv_note: 'Documented source (required)', conv_any: 'All products',
  timezone: 'Time zone', lot_tol_abs: 'Lot gap tolerance (kg)', lot_tol_pct: 'Lot gap tolerance (%)', pace_tol: 'Progress tolerance (%)', rate_tol: 'Rate consistency tolerance (%)', ocr_threshold: 'Photo reading confidence threshold (%)', default_shift_start: 'Default shift start',
  ai_enabled: 'Enable Workers AI second pass', ai_limit: 'Monthly limit (number of readings)', ai_note: 'Off by default. Each reading is billed to your Cloudflare account at Workers AI prices. It stops automatically at the limit.', show_workers_all: 'Show worker names to all viewers',
  tol_note: 'Zero means no tolerance: any difference is flagged. Set these to your policy.', rule_dataset: 'Dataset', rule_metric: 'Measure', rule_kind: 'Kind', rule_agg: 'Aggregation', close_lot: 'Close lot', reopen_lot: 'Reopen', lot_note: 'Note',
  access_owner: 'Owner (from deployment config)', grant: 'Grant “View entire live dashboard”', email: 'Email', display_name: 'Name', show_workers: 'Show worker names to them', revoke: 'Revoke', revoked: 'Revoked', granted: 'Granted',
  access_note: 'A viewer signs in with their email through Cloudflare Access, sees the whole dashboard and changes only their own filters. They cannot upload, edit or approve, and never see originals or review notes.',
  snap_title: 'Snapshot title', snap_sections: 'Sections', snap_expires: 'Expires', snap_recipients: 'Recipients (emails, optional)', snap_create: 'Create snapshot', snap_link: 'Snapshot link', snap_copy: 'Copy link', snap_revoke: 'Revoke snapshot', snap_expired: 'Expired', snap_revoked: 'Revoked', snap_active: 'Active',
  snap_note: 'A snapshot is frozen: it does not change when new data is approved, and it gives no live access.', snap_frozen_at: 'Frozen at', snap_gone: 'This snapshot is no longer available', snap_workers: 'Include worker names',
  backup_last: 'Last successful backup', backup_never: 'No backup has succeeded yet', backup_run: 'Back up now', backup_auto: 'Automatic every night at 02:17 Amman time', rehearse: 'Rehearse a restore into an isolated database', rehearse_passed: 'Restore passed: records and file checksums match', rehearse_failed: 'Restore rehearsal failed',
  export_data: 'Download full export (data)', export_all: 'Download full export with originals', recovery_title: 'Recovery path', recovery_1: '1. Rehearse into the isolated database first and check counts and checksums match.', recovery_2: '2. To restore production to a point in time (up to 30 days) use D1 Time Travel in the Cloudflare dashboard or the steps in the recovery guide.',
  recovery_3: '3. Originals are kept in the backup bucket under their SHA-256, so they survive even if removed from the originals bucket.', tables: 'Tables', files: 'Files', status: 'Status', started: 'Started', finished: 'Finished', run_ok: 'Succeeded', run_failed: 'Failed', run_running: 'Running',
  audit_actor: 'User', audit_action: 'Action', audit_entity: 'Item', audit_at: 'Time', older: 'Older',
  snapshot_banner: 'Frozen snapshot — does not update',
};

export type Lang = 'ar' | 'en';
let lang: Lang = (() => { try { return (localStorage.getItem('lang') as Lang) || 'ar'; } catch { return 'ar'; } })();
const subs = new Set<() => void>();
function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
if (typeof document !== 'undefined') apply();

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch { /* per-viewer convenience only */ }
  apply();
  subs.forEach((f) => f());
}
export function getLang() { return lang; }
export function useLang(): Lang {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang);
}

export function t(key: string, params?: Record<string, string | number | null | undefined>): string {
  let s = (lang === 'ar' ? ar : en)[key] ?? en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] === null || params[k] === undefined ? '—' : String(params[k])));
  return s;
}
export function hasKey(key: string) { return key in en; }

/** Missing-key guard used by tests. */
export const __dicts = { ar, en };

const nf = () => new Intl.NumberFormat(lang === 'ar' ? 'ar-JO' : 'en-GB', { maximumFractionDigits: 3 });
const pf = () => new Intl.NumberFormat(lang === 'ar' ? 'ar-JO' : 'en-GB', { style: 'percent', maximumFractionDigits: 1 });
/** Format thousandths. */
export function fmtQ(milli: number | null | undefined, digits = 3): string {
  if (milli === null || milli === undefined) return t('unavailable');
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-JO' : 'en-GB', { maximumFractionDigits: digits }).format(milli / 1000);
}
export function fmtSigned(milli: number | null | undefined): string {
  if (milli === null || milli === undefined) return t('unavailable');
  const s = fmtQ(Math.abs(milli));
  return milli > 0 ? `+${s}` : milli < 0 ? `−${s}` : s;
}
export function fmtPct(r: number | null | undefined): string {
  return r === null || r === undefined ? t('unavailable') : pf().format(r);
}
export function fmtNum(n: number | null | undefined): string {
  return n === null || n === undefined ? t('unavailable') : nf().format(n);
}
export function fmtTime(ms: number | string | null | undefined, tz = 'Asia/Amman'): string {
  if (ms === null || ms === undefined) return '—';
  const d = typeof ms === 'string' ? new Date(ms) : new Date(ms);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-JO' : 'en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
export function fmtDateTime(ms: number | string | null | undefined, tz = 'Asia/Amman'): string {
  if (ms === null || ms === undefined) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-JO' : 'en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(ms));
}
