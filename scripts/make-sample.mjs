import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "sample.pdf");
const W = 595.28;
const H = 841.89;

const C = {
  paper: rgb(0.976, 0.965, 0.941),
  cream: rgb(0.945, 0.918, 0.855),
  ink: rgb(0.118, 0.165, 0.137),
  green: rgb(0.102, 0.212, 0.176),
  greenSoft: rgb(0.259, 0.365, 0.314),
  terra: rgb(0.722, 0.341, 0.247),
  sand: rgb(0.812, 0.741, 0.604),
  muted: rgb(0.401, 0.435, 0.396),
  white: rgb(1, 1, 1),
};

const fontRegularBytes = await fs.readFile("C:/Windows/Fonts/Deng.ttf");
const fontBoldBytes = await fs.readFile("C:/Windows/Fonts/Dengb.ttf");

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const regular = await pdf.embedFont(fontRegularBytes, { subset: true });
const bold = await pdf.embedFont(fontBoldBytes, { subset: true });

pdf.setTitle("在书页之间，与思想对话 —— 深度阅读手册");
pdf.setAuthor("页间 PAGE TALK");
pdf.setSubject("一份关于慢读、批注与提问的阅读练习册");
pdf.setProducer("页间 · AI PDF 阅读器示例文档");
pdf.setCreationDate(new Date());

function addPage(bg = C.paper) {
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg });
  return page;
}

function text(page, value, x, y, options = {}) {
  page.drawText(value, {
    x,
    y,
    size: options.size ?? 10,
    font: options.bold ? bold : regular,
    color: options.color ?? C.ink,
    opacity: options.opacity ?? 1,
    ...(options.rotate ? { rotate: options.rotate } : {}),
  });
}

function wrap(value, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(value).split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const char of Array.from(paragraph)) {
      const next = line + char;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function paragraph(page, value, x, top, options = {}) {
  const size = options.size ?? 10.5;
  const leading = options.leading ?? size * 1.85;
  const maxWidth = options.maxWidth ?? W - x * 2;
  const lines = wrap(value, options.font ?? regular, size, maxWidth);
  let cursor = top;
  for (const line of lines) {
    if (line) {
      text(page, line, x, H - cursor, {
        size,
        font: options.font,
        bold: options.bold,
        color: options.color ?? C.ink,
        opacity: options.opacity,
      });
    }
    cursor += line ? leading : leading * 0.6;
  }
  return cursor;
}

function overline(page, value, x, top, options = {}) {
  text(page, value, x, H - top, {
    size: options.size ?? 7.5,
    bold: true,
    color: options.color ?? C.terra,
  });
}

function footer(page, number, section = "在书页之间，与思想对话") {
  const y = 35;
  page.drawLine({
    start: { x: 56, y: y + 22 },
    end: { x: W - 56, y: y + 22 },
    thickness: 0.5,
    color: C.sand,
    opacity: 0.65,
  });
  text(page, section, 56, y, { size: 7.5, color: C.muted });
  text(page, String(number).padStart(2, "0"), W - 72, y, {
    size: 8,
    bold: true,
    color: C.terra,
  });
}

function hairline(page, x1, y1, x2, y2, opacity = 0.3, color = C.sand) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.7, color, opacity });
}

/* ---------------- 封面 ---------------- */
{
  const page = addPage(C.green);
  page.drawCircle({ x: 530, y: 735, size: 190, color: C.cream, opacity: 0.055 });
  page.drawCircle({ x: 530, y: 735, size: 135, color: C.cream, opacity: 0.045 });
  page.drawCircle({ x: 78, y: 118, size: 78, color: C.terra, opacity: 0.85 });

  hairline(page, 56, H - 68, W - 56, H - 68, 0.25, C.cream);
  overline(page, "PAGE TALK  /  READING NOTES", 56, 55, { color: C.cream, size: 8 });
  text(page, "阅读练习册 · 01", W - 150, H - 60, { size: 8, color: C.cream, opacity: 0.8 });

  text(page, "在书页之间", 56, 612, { size: 50, bold: true, color: C.cream });
  text(page, "与思想对话", 56, 545, { size: 50, bold: true, color: C.cream });

  page.drawLine({ start: { x: 58, y: 500 }, end: { x: 184, y: 500 }, thickness: 2, color: C.terra });

  text(page, "一本送给慢读者的练习册", 56, 455, { size: 15, color: C.cream, opacity: 0.9 });
  paragraph(
    page,
    "关于停留、在页边写字，\n以及如何向一段文字提出好问题。",
    56,
    700,
    { size: 12, leading: 27, color: C.cream, opacity: 0.72, maxWidth: 330 },
  );

  text(page, "页间编辑部", 56, 96, { size: 9.5, bold: true, color: C.cream });
  text(page, "二〇二六年初秋", 56, 78, { size: 9.5, color: C.cream, opacity: 0.7 });
  text(page, "慢读 · 批注 · 提问", W - 158, 80, {
    size: 9,
    color: C.cream,
    opacity: 0.7,
  });
}

/* ---------------- 序言 ---------------- */
{
  const page = addPage();
  page.drawLine({ start: { x: 78, y: 110 }, end: { x: 78, y: H - 120 }, thickness: 0.7, color: C.sand, opacity: 0.55 });
  overline(page, "A NOTE BEFORE READING", 103, 92);
  text(page, "阅读，是一场", 103, H - 148, { size: 33, bold: true });
  text(page, "缓慢的对话", 103, H - 192, { size: 33, bold: true, color: C.green });
  paragraph(page, "写给每一个不想把书匆匆翻完的人。", 103, 228, {
    size: 11,
    color: C.muted,
  });

  paragraph(
    page,
    "我们常常把阅读理解成「读完」。书页翻过，进度增加，似乎就完成了。但真正留在心里的，往往不是那些被快速扫过的句子，而是某个让你停顿的瞬间。",
    103,
    292,
    { size: 11.2, leading: 24, maxWidth: 400 },
  );

  paragraph(
    page,
    "停顿，是阅读最珍贵的动作。你会在一句话前停下来，想起自己的经历；会在页边写下一个不太确定的问题；会抬头看向窗外，让刚刚读到的内容慢慢沉下去。",
    103,
    376,
    { size: 11.2, leading: 24, maxWidth: 400 },
  );

  paragraph(
    page,
    "这本小册子想邀请你重新练习这种停顿。你不需要读得更快，也不必记住所有东西。只需要在重要的地方留下痕迹，并允许自己向文本提出一个好问题。",
    103,
    474,
    { size: 11.2, leading: 24, maxWidth: 400 },
  );

  page.drawRectangle({ x: 103, y: 160, width: 4, height: 92, color: C.terra });
  paragraph(
    page,
    "“真正的阅读，不是把书页翻完，\n而是让某一页在心里多停留一会儿。”",
    128,
    628,
    { size: 15, leading: 31, color: C.green, maxWidth: 370 },
  );
  footer(page, 2);
}

/* ---------------- 第一章 ---------------- */
{
  const page = addPage();
  text(page, "01", 448, H - 236, { size: 108, bold: true, color: C.cream });
  overline(page, "CHAPTER 01  ·  注意力的归处", 56, 100);
  text(page, "先把注意力，", 56, H - 168, { size: 32, bold: true });
  text(page, "放回一页纸", 56, H - 211, { size: 32, bold: true });
  hairline(page, 58, H - 238, 178, H - 238, 0.9, C.terra);

  paragraph(
    page,
    "信息越多，注意力越像一只被惊动的鸟。它从一个窗口跳到另一个窗口，却很少真正停在某一棵树上。阅读，恰恰要求我们停下来。",
    56,
    303,
    { size: 11.3, leading: 24, maxWidth: 390 },
  );
  paragraph(
    page,
    "停下来，并不意味着你要读懂每一个字。相反，它意味着你允许自己被一段话绊住：为什么是这个词？作者在回避什么？这个例子真的能支持他的结论吗？",
    56,
    390,
    { size: 11.3, leading: 24, maxWidth: 390 },
  );

  page.drawRectangle({ x: 56, y: 188, width: 483, height: 114, color: C.cream, opacity: 0.8 });
  text(page, "慢读不是速度，而是一种关系。", 80, H - 476, {
    size: 15,
    bold: true,
    color: C.green,
  });
  paragraph(page, "你不再只是经过文字，而是与它发生关系：同意、反驳、联想、追问。", 80, 512, {
    size: 10.5,
    leading: 22,
    color: C.greenSoft,
    maxWidth: 420,
  });

  paragraph(
    page,
    "所以，在开始之前，请先把进度条放到一边。接下来的几页，没有标准答案，也没有需要背诵的结论。只有一些邀请：读慢一点，写下来，再问一句。",
    56,
    632,
    { size: 11.3, leading: 24, maxWidth: 430 },
  );
  footer(page, 3, "CHAPTER 01 · 注意力的归处");
}

/* ---------------- 划线之后 ---------------- */
{
  const page = addPage();
  overline(page, "MARGINALIA  ·  页边练习", 56, 88);
  text(page, "划线之后，", 56, H - 150, { size: 31, bold: true });
  text(page, "还能做什么？", 56, H - 190, { size: 31, bold: true, color: C.terra });
  paragraph(
    page,
    "荧光笔留下的是颜色，不是思考。下一次读到重要段落时，试着在页边多做一步。",
    56,
    240,
    { size: 11, leading: 23, color: C.muted, maxWidth: 370 },
  );

  const items = [
    {
      n: "01",
      title: "写下一个判断",
      body: "用一句话概括：作者究竟想让我相信什么？如果只能记住一个观点，会是哪一个？",
    },
    {
      n: "02",
      title: "标记一个疑问",
      body: "把「不太对劲」的感觉具体化。是证据不足，概念模糊，还是你的经验与它相冲突？",
    },
    {
      n: "03",
      title: "寻找一处联结",
      body: "这段话让你想起哪本书、哪段经历或哪个新闻？把新的内容接到旧的知识上。",
    },
  ];

  let top = 300;
  for (const item of items) {
    text(page, item.n, 56, H - top, { size: 10, bold: true, color: C.terra });
    text(page, item.title, 96, H - top - 2, { size: 14, bold: true });
    const end = paragraph(page, item.body, 96, top + 28, {
      size: 10.2,
      leading: 21,
      maxWidth: 355,
      color: C.muted,
    });
    hairline(page, 56, H - end - 4, 456, H - end - 4, 0.5, C.sand);
    top = end + 36;
  }

  // 页边便签
  page.drawRectangle({
    x: 466,
    y: H - 690,
    width: 84,
    height: 140,
    color: rgb(0.953, 0.89, 0.78),
    rotate: { type: "degrees", angle: 4 },
  });
  page.drawRectangle({
    x: 471,
    y: H - 684,
    width: 74,
    height: 128,
    color: rgb(0.969, 0.922, 0.82),
    rotate: { type: "degrees", angle: 4 },
  });
  page.drawLine({
    start: { x: 480, y: H - 620 },
    end: { x: 535, y: H - 624 },
    thickness: 0.5,
    color: C.sand,
  });
  text(page, "不要只", 482, H - 665, { size: 9.5, bold: true, color: C.terra, rotate: { type: "degrees", angle: 4 } });
  text(page, "留下颜色，", 482, H - 680, { size: 9.5, bold: true, color: C.terra, rotate: { type: "degrees", angle: 4 } });
  text(page, "留下判断。", 482, H - 695, { size: 9.5, bold: true, color: C.terra, rotate: { type: "degrees", angle: 4 } });
  footer(page, 4, "MARGINALIA · 页边练习");
}

/* ---------------- 图解页 ---------------- */
{
  const page = addPage(C.cream);
  overline(page, "A SMALL MAP  ·  阅读发生的地方", 56, 86, { color: C.greenSoft });
  text(page, "从信息，到理解", 56, H - 142, { size: 30, bold: true, color: C.green });
  paragraph(page, "一条并不笔直的路。你可以在任何一步停下来，也可以随时返回。", 56, 178, {
    size: 10.5,
    color: C.greenSoft,
    maxWidth: 390,
  });

  const nodes = [
    { x: 95, label: "看见", en: "NOTICE", note: "哪一句让你停了半秒？" },
    { x: 228, label: "复述", en: "RETELL", note: "合上书，用自己的话讲一遍。" },
    { x: 361, label: "联结", en: "CONNECT", note: "它和你已知的什么有关？" },
    { x: 494, label: "发问", en: "ASK", note: "还有什么没有被解释？" },
  ];

  page.drawLine({
    start: { x: 95, y: H - 324 },
    end: { x: 500, y: H - 324 },
    thickness: 0.8,
    color: C.greenSoft,
    opacity: 0.4,
  });

  for (const [index, node] of nodes.entries()) {
    page.drawCircle({ x: node.x, y: H - 324, size: 25, color: page === null ? C.green : C.green });
    page.drawCircle({ x: node.x, y: H - 324, size: 25, color: C.green });
    text(page, String(index + 1), node.x - 4.5, H - 328, {
      size: 12,
      bold: true,
      color: C.cream,
    });
    text(page, node.en, node.x - 18, H - 370, { size: 6.8, bold: true, color: C.terra });
    text(page, node.label, node.x - 17, H - 396, { size: 14, bold: true, color: C.green });
    paragraph(page, node.note, node.x - 38, 428, {
      size: 8.5,
      leading: 16,
      color: C.greenSoft,
      maxWidth: 92,
    });
  }

  page.drawRectangle({ x: 56, y: 251, width: 483, height: 1, color: C.sand });
  page.drawRectangle({ x: 56, y: 70, width: 483, height: 158, color: C.paper });
  text(page, "一个提醒", 80, H - 556, { size: 9, bold: true, color: C.terra });
  paragraph(
    page,
    "理解不是一条自动扶梯。你可能会在第 3 步突然回到第 1 步，发现自己划错了重点；也可能在很久以后，才真正明白当时读过的某句话。",
    80,
    578,
    { size: 11.3, leading: 24, maxWidth: 425, color: C.green },
  );
  paragraph(page, "这不是失败，这是阅读本来的形状。", 80, 652, {
    size: 10,
    leading: 20,
    color: C.greenSoft,
    maxWidth: 400,
  });
  footer(page, 5, "A SMALL MAP · 从信息到理解");
}

/* ---------------- 摘录页 ---------------- */
{
  const page = addPage(C.green);
  page.drawCircle({ x: 520, y: 160, size: 150, color: C.terra, opacity: 0.2 });
  page.drawCircle({ x: 520, y: 160, size: 100, color: C.terra, opacity: 0.2 });
  overline(page, "A SENTENCE TO KEEP", 56, 80, { color: C.sand });
  text(page, "“", 52, H - 220, { size: 96, bold: true, color: C.terra, opacity: 0.9 });
  const lines = ["让问题留在页边，", "不必急着回答。", "", "有些句子，", "要在生活里再读一遍。"];
  let y = H - 280;
  for (const line of lines) {
    if (line) text(page, line, 56, y, { size: 27, bold: true, color: C.cream });
    y -= 54;
  }
  page.drawLine({ start: { x: 58, y: 222 }, end: { x: 158, y: 222 }, thickness: 1, color: C.terra });
  text(page, "写给慢读者的句子", 56, 184, { size: 9.5, color: C.cream, opacity: 0.72 });
  text(page, "页间 · 阅读练习册", W - 160, 184, { size: 8, color: C.cream, opacity: 0.45 });
  footer(page, 6, "A SENTENCE TO KEEP");
}

/* ---------------- 第二章 ---------------- */
{
  const page = addPage();
  text(page, "02", 448, H - 232, { size: 108, bold: true, color: C.cream });
  overline(page, "CHAPTER 02  ·  留白的智慧", 56, 100);
  text(page, "把问题，", 56, H - 168, { size: 32, bold: true });
  text(page, "留在页边", 56, H - 211, { size: 32, bold: true });
  hairline(page, 58, H - 238, 178, H - 238, 0.9, C.terra);

  paragraph(
    page,
    "好的读者，常常也是好的提问者。他们不会急着替作者补全论证，而是允许疑问暂时悬在那里。",
    56,
    303,
    { size: 11.3, leading: 24, maxWidth: 400 },
  );
  paragraph(
    page,
    "疑问是一种未完成的状态。它让你在合上书之后，仍然带着某个问题生活。也许在一次散步、一场谈话，或另一本书里，答案会悄悄出现。",
    56,
    390,
    { size: 11.3, leading: 24, maxWidth: 400 },
  );

  const quotes = [
    "这一段的关键词是什么？如果换一个词，意思会怎样改变？",
    "作者默认了哪些没有说出口的前提？",
    "有没有一个反例，会让这个结论站不住脚？",
  ];
  let top = 500;
  for (const [index, quote] of quotes.entries()) {
    page.drawCircle({ x: 64, y: H - top + 3, size: 8, color: C.terra, opacity: 0.9 });
    text(page, String(index + 1), 61, H - top, { size: 7.5, bold: true, color: C.paper });
    paragraph(page, quote, 84, top + 3, {
      size: 10.5,
      leading: 21,
      maxWidth: 400,
      color: C.greenSoft,
    });
    top += 54;
  }

  page.drawRectangle({ x: 56, y: 166, width: 483, height: 96, color: C.cream });
  text(page, "把书页当作可以交谈的对象，", 78, H - 632, {
    size: 13,
    bold: true,
    color: C.green,
  });
  text(page, "而不是必须服从的权威。", 78, H - 654, { size: 13, bold: true, color: C.green });
  footer(page, 7, "CHAPTER 02 · 把问题留在页边");
}

/* ---------------- 与 AI 共读 ---------------- */
{
  const page = addPage();
  overline(page, "A PRACTICE  ·  一次框选，四次追问", 56, 88);
  text(page, "与 AI 共读的", 56, H - 148, { size: 31, bold: true });
  text(page, "四个提问", 56, H - 188, { size: 31, bold: true, color: C.terra });
  paragraph(
    page,
    "选中书页上的一小块内容，连同你的问题一起交给 AI。不要只问「这是什么意思」，试着让问题更具体。",
    56,
    236,
    { size: 10.7, leading: 23, color: C.muted, maxWidth: 430 },
  );

  const questions = [
    ["01", "概括", "用一句话说明这段话在论证什么。", "把长段落压缩成一个清楚的判断。"],
    ["02", "拆解", "这个比喻让什么变得清楚了？又遮蔽了什么？", "让修辞背后的选择显形。"],
    ["03", "翻译", "译成中文，保留原文的语气与句式。", "翻译也是精读的一种方式。"],
    ["04", "检验", "结合同页上下文，这个结论有哪些前提？", "从接受信息，走向检验信息。"],
  ];

  let top = 310;
  for (const [number, title, question, explain] of questions) {
    text(page, number, 56, H - top, { size: 9, bold: true, color: C.terra });
    text(page, title, 88, H - top - 1, { size: 12.5, bold: true });
    paragraph(page, question, 136, top + 1, {
      size: 10.8,
      leading: 20,
      maxWidth: 398,
      color: C.ink,
    });
    paragraph(page, explain, 136, top + 25, {
      size: 9,
      leading: 17,
      maxWidth: 398,
      color: C.muted,
    });
    top += 82;
    if (number !== "04") hairline(page, 56, H - top + 14, 538, H - top + 14, 0.45, C.sand);
  }

  // 底部流程示意
  page.drawRectangle({ x: 56, y: 76, width: 483, height: 74, color: C.cream });
  const steps = ["框选画面", "写下问题", "获得回答", "继续追问"];
  steps.forEach((step, index) => {
    const x = 78 + index * 116;
    page.drawCircle({ x: x + 9, y: 55, size: 9, color: C.green, opacity: 0.9 });
    text(page, String(index + 1), x + 6.3, 52, { size: 7, bold: true, color: C.paper });
    text(page, step, x + 25, 51, { size: 9, bold: true, color: C.green });
    if (index < steps.length - 1) {
      hairline(page, x + 48, 55, x + 100, 55, 0.5, C.sand);
    }
  });
  footer(page, 8, "A PRACTICE · 与 AI 共读的四个提问");
}

/* ---------------- 练习页 ---------------- */
{
  const page = addPage();
  overline(page, "YOUR TURN  ·  一张自己的阅读图纸", 56, 88);
  text(page, "今天，我在页边", 56, H - 148, { size: 29, bold: true });
  text(page, "留下了什么？", 56, H - 187, { size: 29, bold: true, color: C.terra });

  const boxes = [
    { x: 56, y: 530, w: 234, h: 140, label: "读到的这一页", hint: "书名 / 页码" },
    { x: 305, y: 530, w: 234, h: 140, label: "一个仍然开着的问题", hint: "不必急着回答" },
  ];
  for (const box of boxes) {
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      color: C.paper,
      borderColor: C.sand,
      borderWidth: 0.7,
    });
    text(page, box.label, box.x + 16, box.y + box.h - 24, {
      size: 9,
      bold: true,
      color: C.greenSoft,
    });
    text(page, box.hint, box.x + 16, box.y + 16, { size: 8, color: C.muted });
  }

  text(page, "我注意到的一句话", 56, H - 392, { size: 9.5, bold: true, color: C.terra });
  const lineYs = [438, 474, 510, 546, 582];
  for (const y of lineYs) {
    page.drawLine({
      start: { x: 56, y: H - y },
      end: { x: 539, y: H - y },
      thickness: 0.6,
      color: C.sand,
      opacity: 0.8,
    });
  }

  page.drawRectangle({ x: 56, y: 66, width: 483, height: 68, color: C.cream });
  text(page, "在这里划线、圈点，或者在空白处画一个问号。", 78, H - 710, {
    size: 9.5,
    color: C.green,
    bold: true,
  });
  text(page, "这本书不用交给任何人，除了未来的你。", 78, H - 730, {
    size: 8.5,
    color: C.muted,
  });
  footer(page, 9, "YOUR TURN · 一张自己的阅读图纸");
}

/* ---------------- 结语 ---------------- */
{
  const page = addPage(C.green);
  page.drawCircle({ x: 297, y: 520, size: 210, color: C.cream, opacity: 0.035 });
  overline(page, "AFTERWORD", 56, 80, { color: C.sand });
  text(page, "把书合上之后，", 56, H - 262, { size: 27, bold: true, color: C.cream });
  text(page, "阅读才真正开始。", 56, H - 303, { size: 27, bold: true, color: C.cream });
  paragraph(
    page,
    "你会在某个普通的下午，突然想起书里的那句话。它已经不再只是作者的观点，而成为了你理解世界的一部分。",
    56,
    340,
    { size: 11.4, leading: 26, color: C.cream, opacity: 0.75, maxWidth: 380 },
  );
  page.drawLine({ start: { x: 58, y: 260 }, end: { x: 156, y: 260 }, thickness: 1, color: C.terra });
  text(page, "愿你缓慢、专注，并且始终好奇。", 56, 220, {
    size: 11,
    color: C.cream,
    opacity: 0.9,
  });

  page.drawCircle({
    x: 470,
    y: 126,
    size: 48,
    borderColor: C.sand,
    borderWidth: 0.8,
    color: C.green,
    opacity: 0.9,
  });
  text(page, "页间", 447, 120, { size: 14, bold: true, color: C.cream });
  text(page, "PAGE TALK", 436, 104, { size: 6.5, color: C.sand });

  footer(page, 10, "AFTERWORD · 把书合上之后");
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
const bytes = await pdf.save();
await fs.writeFile(OUT, bytes);
console.log(`示例 PDF 已生成：${OUT} (${(bytes.length / 1024).toFixed(0)} KB)`);
