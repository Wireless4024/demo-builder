-- up
CREATE TABLE Hello
(
    world TEXT
);
INSERT INTO Hello(world)
VALUES ('world 1'),
       ('world 2'),
       ('world 3'),
       ('world 4');

-- down
DROP TABLE Hello;