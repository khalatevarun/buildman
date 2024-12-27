import axios from "axios";
import { ChatMessage } from "../types";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

export const getTemplate = (prompt:string) => {
    return axios.post(`${BACKEND_URL}/template`, {
        prompt
    });
}


  
export  const getChatResponse = (messages: ChatMessage[])  =>{
    return  axios.post(`${BACKEND_URL}/chat`, { messages });
}