import {prisma} from "../db/prisma.js";

const waitlist = await prisma.watchList.findMany()
console.log(waitlist)