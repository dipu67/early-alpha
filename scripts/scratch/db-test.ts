import {prisma} from "../../src/db/prisma.js";

const user = await prisma.twitterAccount.findFirst({
    where: {
        fxCursor: {not: null}
    }
})
console.log(user)