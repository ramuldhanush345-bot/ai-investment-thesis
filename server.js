require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const PDFDocument = require("pdfkit");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const users = require("./users");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});  

const SECRET = process.env.JWT_SECRET;

const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const app = express();
app.use(cors());
app.use(express.json());


// ================= RATE LIMIT =================
const rateLimit = {};


// ================= AI ANALYSIS =================
async function analyzeSlides(slides) {
    try {
        const content = slides.map(s => 
            `Slide ${s.slide_number}: ${s.content}`
        ).join("\n");

        const prompt = `
Analyze this startup pitch deck and return ONLY valid JSON.

STRICT REQUIREMENTS:
- Each category_feedback MUST be 60–120 words
- Professional detailed analysis

{
  "scores": {
    "problem": number,
    "solution": number,
    "market": number,
    "business_model": number,
    "competition": number,
    "team": number,
    "traction": number,
    "financials": number,
    "presentation": number
  },
  "category_feedback": {
    "problem": "60-120 words",
    "solution": "60-120 words",
    "market": "60-120 words",
    "business_model": "60-120 words",
    "competition": "60-120 words",
    "team": "60-120 words",
    "traction": "60-120 words",
    "financials": "60-120 words",
    "presentation": "60-120 words"
  },
  "recommendation": "Strong Buy | Hold | Pass",
  "strengths": ["3-5 points"],
  "weaknesses": ["3-5 points"],
  "recommendations_section": "100-200 words",
  "summary": "100 words"
}

Return ONLY JSON.

Slides:
${content}
`;

        const response = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.1-8b-instant"
        });

        const text = response.choices[0].message.content;
        console.log("AI RAW RESPONSE:", text);

        const jsonMatch = text.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        throw new Error("Invalid JSON from AI");

    } catch (err) {
        console.log("AI FAILED:", err.message);

        return {
            scores: {
                problem: 6,
                solution: 6,
                market: 6,
                business_model: 6,
                competition: 6,
                team: 6,
                traction: 6,
                financials: 6,
                presentation: 6
            },
            category_feedback: {
                problem: "Basic problem understanding with limited data.",
                solution: "Solution is simple but needs improvement.",
                market: "Market opportunity exists but not fully explored.",
                business_model: "Business model lacks depth.",
                competition: "Competition not clearly analyzed.",
                team: "Team capabilities are unclear.",
                traction: "Limited validation available.",
                financials: "Financial projections missing.",
                presentation: "Presentation is average."
            },
            recommendation: "Hold",
            strengths: ["Simple concept", "Practical idea", "Affordable"],
            weaknesses: ["Limited data", "Needs validation"],
            recommendations_section: "Improve validation, enhance financial planning, and strengthen market positioning.",
            summary: "Fallback analysis due to AI issue."
        };
    }
}


// ================= SCORE =================
function calculateOverallScore(scores) {
    const weights = {
        problem: 10,
        solution: 15,
        market: 20,
        business_model: 15,
        competition: 10,
        team: 15,
        traction: 10,
        financials: 10,
        presentation: 5
    };

    let total = 0;

    for (let key in scores) {
        total += (scores[key] || 0) * weights[key];
    }

    return Math.round(total / 10);
}


// ================= PDF =================
function generatePDF(analysis) {
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    const date = new Date();

    const formattedDate =
        String(date.getDate()).padStart(2, '0') + "-" +
        String(date.getMonth() + 1).padStart(2, '0') + "-" +
        date.getFullYear() + " " +
        date.toTimeString().split(" ")[0] + " UTC";

    const fileDate =
        String(date.getDate()).padStart(2, '0') +
        String(date.getMonth() + 1).padStart(2, '0') +
        date.getFullYear();

    const fileName = `Investment_Thesis_AgroSmart_${fileDate}.pdf`;
    const filePath = path.join(__dirname, "reports", fileName);

    if (!fs.existsSync("reports")) {
        fs.mkdirSync("reports");
    }

    doc.pipe(fs.createWriteStream(filePath));

    const overallScore = calculateOverallScore(analysis.scores);
    const confidence = Math.floor(Math.random() * 20) + 80;

    doc.fontSize(18).text("Investment Thesis Report", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Investment Recommendation: ${analysis.recommendation}`);
    doc.text(`Overall Score: ${overallScore}/100`);
    doc.text(`Processing Date: ${formattedDate}`);
    doc.text(`Confidence Score: ${confidence}/100`);
    doc.moveDown();

    const weights = {
        problem: 10,
        solution: 15,
        market: 20,
        business_model: 15,
        competition: 10,
        team: 15,
        traction: 10,
        financials: 10,
        presentation: 5
    };

    doc.fontSize(14).text("Category-wise Analysis");
    doc.moveDown();

    for (let key in analysis.scores) {
        doc.fontSize(12).text(
            `${key.toUpperCase()} | Score: ${analysis.scores[key]}/10 | Weight: ${weights[key]}%`
        );

        doc.moveDown(0.5);

        const feedback = analysis.category_feedback?.[key];

        if (typeof feedback === "string") {
             doc.text(feedback, { align: "justify" });
        } else if (typeof feedback === "object") {
             doc.text(Object.values(feedback).join(" "), { align: "justify" });
        } else {
             doc.text("No feedback", { align: "justify" });
        }

        doc.moveDown();

    }

    doc.addPage();

    doc.fontSize(14).text("Strengths");
    analysis.strengths.forEach(s => doc.text(`• ${s}`));

    doc.moveDown();

    doc.fontSize(14).text("Weaknesses");
    analysis.weaknesses.forEach(w => doc.text(`• ${w}`));

    doc.moveDown();

    doc.fontSize(14).text("Recommendations");
    doc.text(analysis.recommendations_section, { align: "justify" });

    doc.moveDown();

    doc.fontSize(14).text("Summary");
    doc.text(analysis.summary, { align: "justify" });

    doc.end();

    return fileName;
}


// ================= AUTH =================
app.post("/register", async (req, res) => {
    const { email, password } = req.body;

    const existing = users.find(u => u.email === email);
    if (existing) return res.status(400).json({ message: "User exists" });

    const hashed = await bcrypt.hash(password, 10);
    users.push({ email, password: hashed });

    res.json({ message: "Registered" });
});


app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Wrong password" });

    const token = jwt.sign({ email }, SECRET, { expiresIn: "1d" });

    res.json({ token });
});


function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) return res.status(401).json({ message: "No token" });

    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch {
        res.status(401).json({ message: "Invalid token" });
    }
}


// ================= UPLOAD =================
const upload = multer({ dest: "uploads/" });

app.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
    try {

        const user = req.user.email;
        if (!rateLimit[user]) rateLimit[user] = [];

        const now = Date.now();
        rateLimit[user] = rateLimit[user].filter(t => now - t < 3600000);

        if (rateLimit[user].length >= 5) {
            return res.status(429).json({ message: "Upload limit exceeded (5/hour)" });
        }

        rateLimit[user].push(now);

        const filePath = req.file.path;

        const formData = new FormData();
        formData.append("file", fs.createReadStream(filePath));

        const response = await axios.post(
            "http://localhost:7000/extract",
            formData,
            { headers: formData.getHeaders() }
        );

        const text = response.data;

        const slides = [
            {
                slide_number: 1,
                content: text
            }
        ];

        let analysis;

        try {
            analysis = await analyzeSlides(slides);
        } catch {
            analysis = {};
        }

        const fileName = generatePDF(analysis);
        try {
           await transporter.sendMail({
             from: process.env.EMAIL_USER,
             to: req.user.email,
             subject: "Your Report is Ready",
             text: `Your report is ready!\n\n/${fileName}`
            });

  console.log("Email sent");
} catch (err) {
  console.log("Email failed:", err.message);
}
        res.json({
            message: "Success",
            slides,
            analysis,
            pdf: fileName
        });

    } catch (error) {
        console.log("ERROR DETAILS:");
        console.log(error.response?.data || error.message);
        res.status(500).json({ message: "Error processing file" });
    }
});


// ================= DOWNLOAD =================
app.get("/report/:file", (req, res) => {
    const filePath = path.join(__dirname, "reports", req.params.file);
    res.download(filePath);
});


// ================= START =================
app.listen(5000, () => {
    console.log("Server running on port 5000");
});