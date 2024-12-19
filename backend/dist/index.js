"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv").config();
const express_1 = __importDefault(require("express"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const react_1 = require("./defaults/react");
const node_1 = require("./defaults/node");
const prompts_1 = require("./prompts");
const anthropic = new sdk_1.default();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.post("/template", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const prompt = req.body.prompt;
    const response = yield anthropic.messages.create({
        messages: [
            { role: 'user', content: prompt },
        ],
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 200,
        system: "Return either node or react based on what you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra."
    });
    const answer = response.content[0].text; // react or node
    if (answer === "react") {
        res.json({
            prompts: [prompts_1.BASE_PROMPT, `# Project Files\n\nThe following is a list of all project files and their complete contents that are currently visible and accessible to you. ${react_1.basePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json;`],
            uiPrompts: [react_1.basePrompt],
        });
        return;
    }
    if (answer === "node") {
        res.json({
            prompts: [`# Project Files\n\nThe following is a list of all project files and their complete contents that are currently visible and accessible to you. ${node_1.basePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n;`],
            uiPrompts: [node_1.basePrompt],
        });
        return;
    }
    if (answer !== "react" && answer !== "node") {
        res.status(403).send("You cant access this");
        return;
    }
}));
app.post("/chat", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const messages = req.body.messages;
    const response = yield anthropic.messages.create({
        messages: messages,
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8000,
        system: (0, prompts_1.getSystemPrompt)()
    });
    console.log(response);
    res.json({});
}));
app.listen(3000);
// async function main() {
//     anthropic.messages.stream({
//         messages: [
//             {role: 'user', content: "For all designs I ask you to make, have them be beautiful, not cookie cutter. Make webpages that are fully featured and worthy for production.\n\nBy default, this template supports JSX syntax with Tailwind CSS classes, React hooks, and Lucide React for icons. Do not install other packages for UI themes, icons, etc unless absolutely necessary or I request them.\n\nUse icons from lucide-react for logos.\n\nUse stock photos from unsplash where appropriate, only valid URLs you know exist. Do not download the images, only link to them in image tags."},
//             { role: 'user', content: ""},
//             { role: 'user', content: "build a todo app"},
//         ],
//         model: 'claude-3-5-sonnet-20241022',
//         max_tokens: 1024,
//     }).on('text', (text) => {
//         console.log(text);
//     });
// }
// main();
